export type ForgeHeatPhaseResult = {
	finalPercent: number;
	bonus: number;
};

export type ForgeHammerHitResult = {
	finalPercent: number;
	precisionPercent: number;
	bonus: number;
};

export type ForgeSharpenPhaseResult = {
	finalPercent: number;
	bonus: number;
	overshot: boolean;
};

export type ForgeMinigameResult = {
	heat: ForgeHeatPhaseResult;
	hammer: {
		hits: ForgeHammerHitResult[];
		bonusTotal: number;
	};
	sharpen: ForgeSharpenPhaseResult;
	totalScore: number;
};

export type QualityProbabilities = [number, number, number, number, number];

export type RunForgeMinigameOptions = {
	recipeLabel: string;
	/** Called after the minigame is complete, before showing the final results screen.
	 *  onCraft receives the minigame result, the computed probabilities for qualities 1..5, and the chosen quality (1..5).
	 */
	onCraft: (result: ForgeMinigameResult, probs: QualityProbabilities, chosenQuality: number) => Promise<{ itemName: string }> | { itemName: string };
	onCancel?: () => void;
};

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

const percentToWidth = (p: number): string => `${clamp(p, 0, 100).toFixed(2)}%`;

const createOverlayRoot = (): { root: HTMLDivElement; panel: HTMLDivElement } => {
	const root = document.createElement('div');
	root.id = 'forgeMinigameOverlay';
	root.style.cssText = [
		'position:fixed',
		'inset:0',
		'background:rgba(0,0,0,0.72)',
		'display:flex',
		'align-items:center',
		'justify-content:center',
		'z-index:20000',
		'padding:16px',
		'user-select:none',
		'-webkit-user-select:none',
		'touch-action:none',
	].join(';');

	const panel = document.createElement('div');
	panel.style.cssText = [
		'width:min(860px, 96vw)',
		'background:rgba(17,17,17,0.96)',
		'border:1px solid rgba(255,255,255,0.10)',
		'border-radius:14px',
		'padding:16px',
		'color:#fff',
		'box-shadow:0 12px 40px rgba(0,0,0,0.55)',
	].join(';');

	root.appendChild(panel);
	document.body.appendChild(root);
	return { root, panel };
};

const createCraftBar = (opts: {
	targetPercent?: number;
	show100Marker?: boolean;
}): {
	wrap: HTMLDivElement;
	fill: HTMLDivElement;
	movingTick?: HTMLDivElement;
	label: HTMLDivElement;
} => {
	const wrap = document.createElement('div');
	wrap.style.cssText = [
		'position:relative',
		'width:100%',
		'height:22px',
		'border-radius:12px',
		'background:rgba(255,255,255,0.06)',
		'overflow:hidden',
		'border:1px solid rgba(255,255,255,0.10)',
	].join(';');

	const fill = document.createElement('div');
	fill.style.cssText = [
		'position:absolute',
		'left:0',
		'top:0',
		'bottom:0',
		'width:0%',
		'background:linear-gradient(90deg,#ffd700,#ffb84d)',
		'transition:none',
	].join(';');
	wrap.appendChild(fill);

	if (typeof opts.targetPercent === 'number') {
		const marker = document.createElement('div');
		marker.style.cssText = [
			'position:absolute',
			'top:-6px',
			'bottom:-6px',
			`left:${clamp(opts.targetPercent, 0, 100)}%`,
			'width:2px',
			'background:#6ee7ff',
			'box-shadow:0 0 0 3px rgba(110,231,255,0.15)',
		].join(';');
		wrap.appendChild(marker);
	}

	if (opts.show100Marker) {
		const marker100 = document.createElement('div');
		marker100.style.cssText = [
			'position:absolute',
			'top:-6px',
			'bottom:-6px',
			'left:100%',
			'width:2px',
			'background:#fff',
			'opacity:0.8',
		].join(';');
		wrap.appendChild(marker100);
	}

	const label = document.createElement('div');
	label.style.cssText = 'margin-top:10px;color:#ddd;font-size:13px;line-height:1.3;';

	return { wrap, fill, label };
};

const computeHeatBonus = (percent: number): number => {
	// Spec: target at 80%. Exact = +10. 81% = +9.9. 90% => likely +9.0 (common-sense reading).
	// Formula: linear decay of 0.1 per 1% past the target.
	const target = 80;
	if (percent < target) return 0;
	return clamp(10 - (percent - target) * 0.1, 0, 10);
};

const computeHammerBonus = (percent: number): { precisionPercent: number; bonus: number } => {
	// Precision triangle between 40% and 60% with a small deadzone plateau around 50%:
	// - distances <= deadzoneHalf => 100% precision (e.g. deadzoneHalf=0.4 => 49.6..50.4 = 100%)
	// - beyond that, linear falloff until 0 at 40/60
	const target = 50;
	const halfRange = 10; // distance from 50 to 40/60 (40/60 => 0 precision)
	const deadzoneHalf = 0.4; // ±0.4% around 50 considered perfect
	const dist = Math.abs(percent - target);
	let precisionPercent = 0;
	if (dist <= deadzoneHalf) {
		precisionPercent = 100;
	} else {
		// Map (deadzoneHalf..halfRange) -> (100..0)
		precisionPercent = clamp(100 * (1 - (dist - deadzoneHalf) / (halfRange - deadzoneHalf)), 0, 100);
	}

	// Policy: penalize hits under 90% but scale the penalty with distance to 90%:
	// closer to 90% -> less penalty; very low precision (ex: 10%) -> much stronger penalty.
	// Use a linear interpolation of a multiplier between PENALTY_MIN (at 0%) and 1.0 (at 90%).
	const PENALTY_MIN = 0.15; // multiplier at precision=0 (tunable)
	const BOOST_LOW = 90;
	const BOOST_SRC_HIGH = 96; // src value that maps to effective 100
	const BOOST_SCALE = (100 - BOOST_LOW) / (BOOST_SRC_HIGH - BOOST_LOW); // = 10/6 ~1.666

	let effectivePrecision = 0;
	if (precisionPercent <= 0) {
		effectivePrecision = 0;
	} else if (precisionPercent < 90) {
		const t = precisionPercent / 90; // 0..1
		const mul = PENALTY_MIN + (1 - PENALTY_MIN) * t; // interpolation
		effectivePrecision = precisionPercent * mul;
	} else {
		effectivePrecision = BOOST_LOW + (precisionPercent - BOOST_LOW) * BOOST_SCALE;
		effectivePrecision = Math.min(100, effectivePrecision);
	}

	// Max bonus per perfect hit = 1.3
	const maxPerHit = 1.3;
	return { precisionPercent, bonus: clamp((effectivePrecision / 100) * maxPerHit, 0, maxPerHit) };
};

const computeSharpenBonus = (percent: number, currentScore: number): ForgeSharpenPhaseResult => {
	const overshot = percent > 100;
	if (overshot) return { finalPercent: percent, bonus: 0, overshot: true };
	const pct = clamp(percent, 0, 100);
	// Spec: +0%..+10% of the CURRENT score (heat+hammer).
	// 100% => +10% of currentScore ; 99% => +9.9% of currentScore ; etc.
	const mult = (pct / 100) * 0.1;
	return { finalPercent: percent, bonus: Math.max(0, currentScore) * mult, overshot: false };
};

export async function runForgeMinigame(options: RunForgeMinigameOptions): Promise<ForgeMinigameResult | null> {
	const { root, panel } = createOverlayRoot();
	let cancelled = false;

	const cleanup = () => {
		try {
			root.remove();
		} catch {
			// noop
		}
	};

	const cancel = () => {
		if (cancelled) return;
		cancelled = true;
		try {
			options.onCancel?.();
		} catch {
			// noop
		}
		cleanup();
	};

	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			e.preventDefault();
			cancel();
		}
	};
	document.addEventListener('keydown', onKeyDown);

	const safeCleanup = () => {
		document.removeEventListener('keydown', onKeyDown);
		cleanup();
	};

	const setHeader = (title: string, subtitle: string) => {
		panel.innerHTML = '';
		const top = document.createElement('div');
		top.style.cssText = 'display:flex;align-items:flex-start;gap:12px;justify-content:space-between;';
		top.innerHTML = `
			<div>
				<div style="font-weight:950;font-size:18px;">Forge — ${title}</div>
				<div style="color:#bbb;font-size:12px;margin-top:3px;">${subtitle}</div>
			</div>
			<button class="btn" id="forgeMinigameCloseBtn" style="min-width:110px;">Annuler</button>
		`;
		panel.appendChild(top);
		(panel.querySelector('#forgeMinigameCloseBtn') as HTMLButtonElement | null)?.addEventListener('click', (e) => {
			e.stopPropagation();
			cancel();
		});

		const recipe = document.createElement('div');
		recipe.style.cssText = 'margin-top:10px;color:#ffd700;font-weight:800;';
		recipe.textContent = options.recipeLabel;
		panel.appendChild(recipe);
	};

	try {
		// -------------------- Phase 1: Chauffe --------------------
		setHeader('Chauffe', 'Maintiens le clic pour chauffer. Relâche sur le trait bleu (80%) ou juste après, en dépassant le moins possible.');
		const bar = createCraftBar({ targetPercent: 80 });
		bar.label.textContent = 'Astuce: si tu relâches trop tôt, tu peux maintenir à nouveau pour continuer.';
		panel.appendChild(document.createElement('div')).style.cssText = 'height:12px;';
		panel.appendChild(bar.wrap);
		panel.appendChild(bar.label);

		const heatInfo = document.createElement('div');
		heatInfo.style.cssText = 'margin-top:10px;color:#ddd;font-size:13px;';
		panel.appendChild(heatInfo);

		let heatPercent = 0;
		let heatHolding = false;
		let heatDone = false;
		let lastT = 0;
		// Seconds held during the current press (resets each pointerdown)
		let currentHoldSeconds = 0;

		const updateHeatInfo = () => {
			const bonusPreview = computeHeatBonus(heatPercent);
			heatInfo.textContent = `Chauffe: ${heatPercent.toFixed(1)}% — Bonus si validé maintenant: +${bonusPreview.toFixed(1)}`;
		};
		updateHeatInfo();

		const heatRAF = (t: number) => {
			if (cancelled) return;
			if (heatDone) return;
			if (!heatHolding) { lastT = t; requestAnimationFrame(heatRAF); return; }
			const dt = Math.max(0, (t - lastT) / 1000);
			lastT = t;

			// Track seconds held during the CURRENT press only (resets each pointerdown).
			currentHoldSeconds += dt;

			// Strong exponential acceleration within the press: starts slow, then ramps very quickly.
			const minRate = 15.0; // %/s at start of each press (much faster base speed)
			const accel = 5.0; // exponent per second (increased for much faster ramp)
			const maxRate = 260; // cap velocity
			const velocity = clamp(minRate * Math.exp(accel * currentHoldSeconds), 0, maxRate);
			heatPercent = clamp(heatPercent + velocity * dt, 0, 100);
			bar.fill.style.width = percentToWidth(heatPercent);
			updateHeatInfo();

			requestAnimationFrame(heatRAF);
		};
		requestAnimationFrame(heatRAF);

		const heatPointerDown = (e: PointerEvent) => {
			if (heatDone) return;
			if (e.button !== 0) return;
			// SFX: play fireball sound on each press during heat phase
			try { (window as any).game?.audioManager?.play('bouledefeu'); } catch { /* noop */ }
			// Reset per-press timer so each new press starts slow then accelerates.
			currentHoldSeconds = 0;
			heatHolding = true;
			try { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* noop */ }
		};

		const heatPointerUp = () => {
			if (heatDone) return;
			heatHolding = false;
			if (heatPercent >= 80) {
				heatDone = true;
			}
		};

		bar.wrap.addEventListener('pointerdown', heatPointerDown);
		window.addEventListener('pointerup', heatPointerUp);

		await new Promise<void>((resolve) => {
			const check = () => {
				if (cancelled) return resolve();
				if (heatDone) return resolve();
				requestAnimationFrame(check);
			};
			requestAnimationFrame(check);
		});

		bar.wrap.removeEventListener('pointerdown', heatPointerDown);
		window.removeEventListener('pointerup', heatPointerUp);
		if (cancelled) { safeCleanup(); return null; }

		const heatBonus = computeHeatBonus(heatPercent);
		const heatResult: ForgeHeatPhaseResult = { finalPercent: heatPercent, bonus: heatBonus };

		// -------------------- Phase 2: Marteau (4 coups) --------------------
		setHeader('Forge (Marteau)', 'Clique pour lancer le coup, puis clique pour arrêter le trait au plus près du curseur (50%).');
		const hammerBar = createCraftBar({ targetPercent: 50 });
		hammerBar.label.textContent = '4 coups. Chaque coup parfait donne +1.3, sinon proportionnel à ta précision (max 1.3).';
		panel.appendChild(document.createElement('div')).style.cssText = 'height:12px;';
		panel.appendChild(hammerBar.wrap);
		panel.appendChild(hammerBar.label);

		// Visual aid: highlight the precision zone between 40% and 50% (left) and 50% and 60% (right)
		const zoneLeft = 40;
		const zoneRight = 60;
		const zone = document.createElement('div');
		zone.style.cssText = [
			'position:absolute',
			'top:0',
			'bottom:0',
			`left:${zoneLeft}%`,
			`width:${zoneRight - zoneLeft}%`,
			'background:rgba(110,231,255,0.12)',
			'border-radius:8px',
			'pointer-events:none',
		].join(';');
		hammerBar.wrap.appendChild(zone);

		const makeTick = (pct: number) => {
			const t = document.createElement('div');
			t.style.cssText = [
				'position:absolute',
				'top:-6px',
				'bottom:-6px',
				`left:${pct}%`,
				'width:2px',
				'background:#6ee7ff',
				'box-shadow:0 0 0 6px rgba(110,231,255,0.06)',
				'pointer-events:none',
			].join(';');
			return t;
		};
		hammerBar.wrap.appendChild(makeTick(zoneLeft));
		hammerBar.wrap.appendChild(makeTick(zoneRight));

		const hammerInfo = document.createElement('div');
		hammerInfo.style.cssText = 'margin-top:10px;color:#ddd;font-size:13px;white-space:pre-line;';
		panel.appendChild(hammerInfo);

		const moving = document.createElement('div');
		moving.style.cssText = [
			'position:absolute',
			'top:-6px',
			'bottom:-6px',
			'left:0%',
			'width:2px',
			'background:#fff',
			'box-shadow:0 0 0 3px rgba(255,255,255,0.12)',
			'opacity:0',
		].join(';');
		hammerBar.wrap.appendChild(moving);

		const hammerHits: ForgeHammerHitResult[] = [];
		let hitIndex = 0;
		let running = false;
		let startTime = 0;
		let pendingResolve: (() => void) | null = null;

		const HAMMER_RUN_MS = 1000;

		const renderHammerInfo = (last?: ForgeHammerHitResult) => {
			const lines: string[] = [];
			lines.push(`Coup ${Math.min(hitIndex + 1, 5)}/5`);
			if (last) {
				lines.push(`Résultat: ${last.finalPercent.toFixed(1)}% — Précision: ${last.precisionPercent.toFixed(0)}% — Bonus: +${last.bonus.toFixed(2)}`);
			}
			const total = hammerHits.reduce((s, h) => s + h.bonus, 0);
			lines.push(`Total marteau: +${total.toFixed(2)}`);
			hammerInfo.textContent = lines.join('\n');
		};
		renderHammerInfo();

		const hammerRAF = (t: number) => {
			if (cancelled) return;
			if (!running) { requestAnimationFrame(hammerRAF); return; }
			const elapsed = t - startTime;
			const pct = clamp((elapsed / HAMMER_RUN_MS) * 100, 0, 100);
			moving.style.left = `${pct}%`;
			moving.style.opacity = '1';
			if (elapsed >= HAMMER_RUN_MS) {
				// Auto-stop at end
				running = false;
				moving.style.opacity = '0.85';
				const { precisionPercent, bonus } = computeHammerBonus(100);
				const res: ForgeHammerHitResult = { finalPercent: 100, precisionPercent, bonus };
				hammerHits.push(res);
				// SFX: play instant feedback for this hit
				try {
					(window as any).game?.audioManager?.play(res.precisionPercent >= 90 ? 'forge_crit' : 'forge_bad');
				} catch { /* noop */ }
				hitIndex++;
				renderHammerInfo(res);
				setTimeout(() => {
					moving.style.opacity = '0';
					if (pendingResolve) { const r = pendingResolve; pendingResolve = null; r(); }
				}, 220);
			}
			requestAnimationFrame(hammerRAF);
		};
		requestAnimationFrame(hammerRAF);

		const waitOneHammerHit = async (): Promise<void> => {
			await new Promise<void>((resolve) => {
				pendingResolve = resolve;
			});
		};

		const clickHandler = async () => {
			if (cancelled) return;
			if (hitIndex >= 4) return;
			if (!running) {
				// Start the run
				running = true;
				startTime = performance.now();
				moving.style.opacity = '1';
				moving.style.left = '0%';
				renderHammerInfo();
				return;
			}

			// Stop the run
			running = false;
			const elapsed = performance.now() - startTime;
			const pct = clamp((elapsed / HAMMER_RUN_MS) * 100, 0, 100);
			moving.style.left = `${pct}%`;
			const { precisionPercent, bonus } = computeHammerBonus(pct);
			const res: ForgeHammerHitResult = { finalPercent: pct, precisionPercent, bonus };
			hammerHits.push(res);
			// SFX: play instant feedback for this hit
			try {
				(window as any).game?.audioManager?.play(res.precisionPercent >= 90 ? 'forge_crit' : 'forge_bad');
			} catch { /* noop */ }
			hitIndex++;
			renderHammerInfo(res);
			setTimeout(() => {
				moving.style.opacity = '0';
				if (pendingResolve) { const r = pendingResolve; pendingResolve = null; r(); }
			}, 220);
		};

		hammerBar.wrap.addEventListener('click', (e) => { e.stopPropagation(); void clickHandler(); });

		while (hitIndex < 4 && !cancelled) {
			await waitOneHammerHit();
		}

		// Note: listener is attached via wrapper closure; removing the node at phase switch is enough.
		if (cancelled) { safeCleanup(); return null; }

		const hammerBonusTotal = hammerHits.reduce((s, h) => s + h.bonus, 0);
		const scoreBeforeSharpen = heatResult.bonus + hammerBonusTotal;

		// -------------------- Phase 3: Affûtage --------------------
		setHeader('Affûtage', "Arrête le curseur au plus près de 100% (avant). Si tu dépasses 100%, bonus = 0.");
		const sharpenBar = createCraftBar({ show100Marker: true });
		sharpenBar.label.textContent = 'Clique pour démarrer, puis clique pour arrêter. (Durée: ~1.5s jusqu’à 100%).';
		panel.appendChild(document.createElement('div')).style.cssText = 'height:12px;';
		panel.appendChild(sharpenBar.wrap);
		panel.appendChild(sharpenBar.label);

		const sharpenInfo = document.createElement('div');
		sharpenInfo.style.cssText = 'margin-top:10px;color:#ddd;font-size:13px;white-space:pre-line;';
		panel.appendChild(sharpenInfo);

		const sharpenTick = document.createElement('div');
		sharpenTick.style.cssText = [
			'position:absolute',
			'top:-6px',
			'bottom:-6px',
			'left:0%',
			'width:2px',
			'background:#fff',
			'box-shadow:0 0 0 3px rgba(255,255,255,0.12)',
		].join(';');
		sharpenBar.wrap.appendChild(sharpenTick);

		const SHARP_TO_100_MS = 1500;
		const SHARP_EXTRA_MS = 320; // allows slight overshoot
		const SHARP_MAX_PCT = 110;
		let sharpenRunning = false;
		let sharpenStarted = false;
		let sharpenStart = 0;
		let sharpenFinal = 0;
		let sharpenDone = false;

		const renderSharpenInfo = (p: number) => {
			const preview = computeSharpenBonus(p, scoreBeforeSharpen);
			const bonusText = preview.overshot ? '+0 (dépassé)' : `+${preview.bonus.toFixed(2)}`;
			sharpenInfo.textContent = `Affûtage: ${p.toFixed(1)}%\nBonus: ${bonusText}`;
		};
		renderSharpenInfo(0);

		const sharpenRAF = (t: number) => {
			if (cancelled) return;
			if (!sharpenRunning) { requestAnimationFrame(sharpenRAF); return; }
			const elapsed = t - sharpenStart;
			const totalMs = SHARP_TO_100_MS + SHARP_EXTRA_MS;
			const pct = clamp((elapsed / totalMs) * SHARP_MAX_PCT, 0, SHARP_MAX_PCT);
			sharpenTick.style.left = `${pct}%`;
			renderSharpenInfo(pct);
			if (elapsed >= totalMs) {
				sharpenRunning = false;
				sharpenFinal = pct;
				sharpenDone = true;
			}
			requestAnimationFrame(sharpenRAF);
		};
		requestAnimationFrame(sharpenRAF);

		const sharpenClick = () => {
			if (cancelled) return;
			if (sharpenDone) return;
			if (!sharpenStarted) {
				// SFX: play grindstone sound on first click of sharpening phase
				try { (window as any).game?.audioManager?.play('forge_meule'); } catch { /* noop */ }
				sharpenStarted = true;
				sharpenRunning = true;
				sharpenStart = performance.now();
				return;
			}
			if (sharpenRunning) {
				// Stop the grindstone sound when user stops the sharpening run
				try { (window as any).game?.audioManager?.pause('forge_meule'); } catch { /* noop */ }
				sharpenRunning = false;
				const elapsed = performance.now() - sharpenStart;
				const totalMs = SHARP_TO_100_MS + SHARP_EXTRA_MS;
				sharpenFinal = clamp((elapsed / totalMs) * SHARP_MAX_PCT, 0, SHARP_MAX_PCT);
				sharpenTick.style.left = `${sharpenFinal}%`;
				sharpenDone = true;
			}
		};

		sharpenBar.wrap.addEventListener('click', (e) => { e.stopPropagation(); sharpenClick(); });

		await new Promise<void>((resolve) => {
			const check = () => {
				if (cancelled) return resolve();
				if (sharpenDone) return resolve();
				requestAnimationFrame(check);
			};
			requestAnimationFrame(check);
		});

		// Note: listener is attached via wrapper closure; removing the node at phase switch is enough.
		if (cancelled) { safeCleanup(); return null; }

		const sharpenRes = computeSharpenBonus(sharpenFinal, scoreBeforeSharpen);

		const totalScore = heatResult.bonus + hammerBonusTotal + sharpenRes.bonus;
		const result: ForgeMinigameResult = {
			heat: heatResult,
			hammer: { hits: hammerHits, bonusTotal: hammerBonusTotal },
			sharpen: sharpenRes,
			totalScore,
		};

		// --- Compute quality distribution based on totalScore (continuous mapping)
		const clampScore = (s: number) => Math.max(14, Math.min(20, s));
		const scoreForQuality = clampScore(totalScore);
		const k_U = 3.0, c_U = 17.0;
		const k_H = 1.2, c_H = 20.0;
		const k2 = 1.0, c2 = 16.5;
		const k3 = 1.2, c3 = 17.0;
		const sigmoid = (k: number, c: number, x: number) => 1 / (1 + Math.exp(-k * (x - c)));
		const U = sigmoid(k_U, c_U, scoreForQuality); // mass for Q4+Q5
		const h = sigmoid(k_H, c_H, scoreForQuality); // split Q5 fraction
		const s2 = sigmoid(k2, c2, scoreForQuality);
		const s3 = sigmoid(k3, c3, scoreForQuality);
		const p5 = U * h;
		const p4 = U * (1 - h);
		const base = 1 - U;
		const p1 = base * (1 - s2);
		const p2 = base * s2 * (1 - s3);
		const p3 = base * s2 * s3;
		// Normalize (guard vs tiny numeric error)
		const sum = p1 + p2 + p3 + p4 + p5;
		const probs: QualityProbabilities = [p1 / sum, p2 / sum, p3 / sum, p4 / sum, p5 / sum];
		// Choose final quality by random roll
		const rnd = Math.random();
		let acc = 0;
		let chosenQuality = 1;
		for (let i = 0; i < probs.length; i++) {
			acc += (probs[i] ?? 0);
			if (rnd <= acc) { chosenQuality = i + 1; break; }
		}


		// Create item now (so the final screen can say "Objet créé") — pass probs and chosen quality to caller so it can attach metadata.
		let createdName = '';
		try {
			const craftResult = await options.onCraft(result, probs, chosenQuality);
			createdName = String((craftResult as any)?.itemName ?? 'Objet');
		} catch {
			createdName = 'Objet';
		}

		// -------------------- Final results --------------------
		panel.innerHTML = `
			<div style="display:flex;align-items:flex-start;gap:12px;justify-content:space-between;">
				<div>
					<div style="font-weight:950;font-size:18px;">Forge — Résultat</div>
					<div style="color:#bbb;font-size:12px;margin-top:3px;">Objet créé: <span style="color:#fff;font-weight:800;">${createdName}</span></div>
				</div>
				<button class="btn" id="forgeMinigameDoneBtn" style="min-width:120px;">Fermer</button>
			</div>

			<div style="margin-top:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px;">
				<div style="font-weight:900;color:#ffd700;">Score de fabrication: ${totalScore.toFixed(2)}</div>
				<div style="color:#bbb;font-size:12px;margin-top:6px;">(Pour l'instant, ce score n'influence pas les stats de l'objet — il est juste affiché/stocké.)</div>
				<div id="forgeMinigameBreakdown" style="margin-top:8px;color:#ddd;font-size:13px;white-space:pre-line;"></div>
				<div id="forgeMinigameQuality" style="margin-top:8px;color:#ddd;font-size:13px;white-space:pre-line;"></div>
		`;

		const breakdownEl = panel.querySelector('#forgeMinigameBreakdown') as HTMLDivElement | null;
		if (breakdownEl) {
			const lines: string[] = [];
			lines.push(`Chauffe: ${heatResult.finalPercent.toFixed(1)}% → +${heatResult.bonus.toFixed(1)}`);
			lines.push(`Marteau: +${hammerBonusTotal.toFixed(2)} (4 coups)`);
			let i = 0;
			for (const h of hammerHits) {
				lines.push(`  - Coup ${i + 1}: ${h.finalPercent.toFixed(1)}% (précision ${h.precisionPercent.toFixed(0)}%) → +${h.bonus.toFixed(2)}`);
				i++;
			}
			const s = sharpenRes;
			lines.push(`Affûtage: ${s.finalPercent.toFixed(1)}% → ${s.overshot ? '+0 (dépassé)' : `+${s.bonus.toFixed(1)}`}`);
			breakdownEl.textContent = lines.join('\n');
		}
		// Show quality probabilities and chosen quality with color badge
		const qualEl = panel.querySelector('#forgeMinigameQuality') as HTMLDivElement | null;
		if (qualEl) {
			const colorMap = ['#ffffff', '#4caf50', '#2196f3', '#9c27b0', '#ffb300'];
			const nameMap = ['Blanc', 'Vert', 'Bleu', 'Violet', 'Orange/Doré'];
			let html = `<div style="font-weight:700;margin-bottom:6px;color:#ffd700;">Chances par qualité:</div>`;
			html += '<div style="font-family:monospace;color:#ddd;">';
			for (let q = 1; q <= probs.length; q++) {
				html += `<div>Q${q}: ${( (probs[q - 1] ?? 0) * 100 ).toFixed(2)}%</div>`;
			}
			html += '</div>';
			const q = chosenQuality;
			const badgeColor = colorMap[Math.max(0, Math.min(colorMap.length - 1, q - 1))];
			const badgeName = nameMap[Math.max(0, Math.min(nameMap.length - 1, q - 1))];
		html += `<div style="margin-top:8px;display:flex;align-items:center;gap:8px;"><div style="width:12px;height:12px;border-radius:2px;background:${badgeColor};box-shadow:0 0 8px ${badgeColor};"></div><div style="color:#fff;font-weight:800;">Qualité obtenue: ${q} (${badgeName})</div></div>`;
			qualEl.innerHTML = html;
		}

		await new Promise<void>((resolve) => {
			(panel.querySelector('#forgeMinigameDoneBtn') as HTMLButtonElement | null)?.addEventListener('click', (e) => {
				e.stopPropagation();
				safeCleanup();
				resolve();
			});
		});

		return result;
	} finally {
		// If the overlay is still present (cancel path), remove listeners and clean.
		document.removeEventListener('keydown', onKeyDown);
		if (!cancelled && document.body.contains(root)) {
			try { root.remove(); } catch { /* noop */ }
		}
	}
}
