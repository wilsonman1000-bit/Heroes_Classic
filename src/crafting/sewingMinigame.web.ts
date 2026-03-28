export type SewingAlignPhaseResult = {
	finalTranslatePx: { x: number; y: number };
	finalRotationDeg: number;
	translationErrorPx: number;
	rotationErrorDeg: number;
	overlapPercent: number;
	score: number; // 0..100
};

export type SewingCutPhaseResult = {
	samples: number;
	meanDistancePx: number;
	stdDistancePx: number;
	outsidePercent: number; // 0..1
	score: number; // 0..100
	partialFail: boolean;
};

export type SewingMinigameResult = {
	alignRounds: SewingAlignPhaseResult[];
	cut: SewingCutPhaseResult;
	cutContribution: number; // 0..10
	alignContributions: number[]; // per round contribution, each 0..3.3
	totalScore: number; // somme des contributions (0..~19.9)
};

export type QualityProbabilities = [number, number, number, number, number];

export type RunSewingMinigameOptions = {
	recipeLabel: string;
	/** Called after the minigame succeeds (i.e. not cancelled, and not partial-fail).
	 *  onCraft receives the minigame result, the computed probabilities for qualities 1..5, and the chosen quality (1..5).
	 */
	onCraft: (result: SewingMinigameResult, probs: QualityProbabilities, chosenQuality: number) => Promise<{ itemName: string }> | { itemName: string };
	/** Called when the cut phase exceeds the failure threshold.
	 *  Use this to consume materials even if no item is created.
	 */
	onPartialFail?: (result: SewingMinigameResult) => void;
	onCancel?: () => void;
};

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

const createOverlayRoot = (): { root: HTMLDivElement; panel: HTMLDivElement } => {
	const root = document.createElement('div');
	root.id = 'sewingMinigameOverlay';
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
		'width:min(920px, 96vw)',
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

const computeQualityFromScore14_20 = (score14_20: number): { probs: QualityProbabilities; chosenQuality: number } => {
	const clampScore = (s: number) => Math.max(14, Math.min(20, s));
	const scoreForQuality = clampScore(score14_20);
	const k_U = 3.0, c_U = 17.0;
	const k_H = 1.2, c_H = 20.0;
	const k2 = 1.0, c2 = 16.5;
	const k3 = 1.2, c3 = 17.0;
	const sigmoid = (k: number, c: number, x: number) => 1 / (1 + Math.exp(-k * (x - c)));
	const U = sigmoid(k_U, c_U, scoreForQuality);
	const h = sigmoid(k_H, c_H, scoreForQuality);
	const s2 = sigmoid(k2, c2, scoreForQuality);
	const s3 = sigmoid(k3, c3, scoreForQuality);
	const p5 = U * h;
	const p4 = U * (1 - h);
	const base = 1 - U;
	const p1 = base * (1 - s2);
	const p2 = base * s2 * (1 - s3);
	const p3 = base * s2 * s3;
	const sum = p1 + p2 + p3 + p4 + p5;
	const probs: QualityProbabilities = [p1 / sum, p2 / sum, p3 / sum, p4 / sum, p5 / sum];

	const rnd = Math.random();
	let acc = 0;
	let chosenQuality = 1;
	for (let i = 0; i < probs.length; i++) {
		acc += (probs[i] ?? 0);
		if (rnd <= acc) { chosenQuality = i + 1; break; }
	}
	return { probs, chosenQuality };
};

const fmtPct = (n01: number) => `${(clamp(n01, 0, 1) * 100).toFixed(2)}%`;

const qualityBadgeHtml = (q: number): string => {
	const colors = ['#ffffff', '#4caf50', '#2196f3', '#9c27b0', '#ffb300'];
	const color = colors[(q - 1) | 0] ?? '#ffffff';
	return `<span style="display:inline-flex;align-items:center;gap:8px;">
		<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${color};box-shadow:0 0 0 2px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.08) inset;"></span>
		<span style="font-weight:900;">Q${q}</span>
	</span>`;
};

const distancePointToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
	const abx = bx - ax;
	const aby = by - ay;
	const apx = px - ax;
	const apy = py - ay;
	const abLen2 = abx * abx + aby * aby;
	if (abLen2 <= 1e-9) return Math.hypot(px - ax, py - ay);
	let t = (apx * abx + apy * aby) / abLen2;
	t = clamp(t, 0, 1);
	const cx = ax + abx * t;
	const cy = ay + aby * t;
	return Math.hypot(px - cx, py - cy);
};

const computeMeanAndStd = (values: number[]): { mean: number; std: number } => {
	if (!values.length) return { mean: 0, std: 0 };
	let sum = 0;
	for (const v of values) sum += v;
	const mean = sum / values.length;
	let varSum = 0;
	for (const v of values) {
		const d = v - mean;
		varSum += d * d;
	}
	const std = Math.sqrt(varSum / values.length);
	return { mean, std };
};

const rectIntersectionArea = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number => {
	const x1 = Math.max(a.x, b.x);
	const y1 = Math.max(a.y, b.y);
	const x2 = Math.min(a.x + a.w, b.x + b.w);
	const y2 = Math.min(a.y + a.h, b.y + b.h);
	const w = x2 - x1;
	const h = y2 - y1;
	if (w <= 0 || h <= 0) return 0;
	return w * h;
};

export async function runSewingMinigame(options: RunSewingMinigameOptions): Promise<SewingMinigameResult | null> {
	const { root, panel } = createOverlayRoot();
	let cancelled = false;
	const safeCleanup = () => {
		try { root.remove(); } catch { /* noop */ }
	};
	const waitMs = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
	const raceCancel = async <T>(p: Promise<T>): Promise<T | null> => {
		const cancelP = new Promise<null>((resolve) => {
			const tick = () => {
				if (cancelled) return resolve(null);
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});
		return (await Promise.race([p, cancelP])) as T | null;
	};
	const rand = (min: number, max: number) => min + Math.random() * (max - min);
	const tremorSeed = Math.floor(Math.random() * 1_000_000_000);
	const tremor2D = (nowMs: number, ampPx: number, phase: number): { dx: number; dy: number } => {
		const t = nowMs / 1000;
		const f1 = 11.0;
		const f2 = 17.0;
		const dx = (Math.sin(t * f1 + phase) + 0.55 * Math.sin(t * f2 + phase * 1.9)) * ampPx;
		const dy = (Math.cos(t * f1 * 0.92 + phase * 1.3) + 0.55 * Math.cos(t * f2 * 0.88 + phase * 2.1)) * ampPx;
		return { dx, dy };
	};
	const tremorRotDeg = (nowMs: number, ampDeg: number, phase: number): number => {
		const t = nowMs / 1000;
		return (Math.sin(t * 9.5 + phase * 1.7) + 0.45 * Math.sin(t * 15.5 + phase * 0.6)) * ampDeg;
	};

	const closeBtnId = 'sewingMinigameCloseBtn';
	const setHeader = (title: string, subtitle: string) => {
		panel.innerHTML = `
			<div style="display:flex;align-items:flex-start;gap:12px;justify-content:space-between;">
				<div>
					<div style="font-weight:950;font-size:18px;">Couture — ${title}</div>
					<div style="color:#bbb;font-size:12px;margin-top:3px;">${subtitle}</div>
					<div style="color:#999;font-size:12px;margin-top:6px;">Recette: <span style="color:#fff;font-weight:800;">${options.recipeLabel}</span></div>
				</div>
				<button class="btn" id="${closeBtnId}" style="min-width:110px;">Annuler</button>
			</div>
		`;
		(panel.querySelector(`#${closeBtnId}`) as HTMLButtonElement | null)?.addEventListener('click', (e) => {
			e.stopPropagation();
			cancelled = true;
			try { options.onCancel?.(); } catch { /* noop */ }
			safeCleanup();
		});
	};

	// -------------------- Phase 1: Cut (drag blade along template) --------------------
	setHeader('Découpe', 'Démarre au point A, puis rejoins le point B (sans trop sortir du gabarit).');

	const cutWrap = document.createElement('div');
	cutWrap.style.cssText = [
		'margin-top:14px',
		'display:grid',
		'grid-template-columns: 1fr 260px',
		'gap:12px',
		'align-items:start',
	].join(';');

	const cutStage = document.createElement('div');
	cutStage.style.cssText = [
		'position:relative',
		'height:360px',
		'border-radius:14px',
		'border:1px solid rgba(255,255,255,0.10)',
		'background: linear-gradient(0deg, rgba(255,255,255,0.02), rgba(255,255,255,0.02))',
		'overflow:hidden',
		'touch-action:none',
	].join(';');

	const canvas = document.createElement('canvas');
	canvas.width = 900;
	canvas.height = 520;
	canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
	cutStage.appendChild(canvas);

	const blade = document.createElement('div');
	blade.style.cssText = [
		'position:absolute',
		'width:18px',
		'height:18px',
		'border-radius:6px',
		'background:#e5e7eb',
		'box-shadow:0 10px 22px rgba(0,0,0,0.45)',
		'border:1px solid rgba(0,0,0,0.35)',
		'transform: translate(-50%, -50%)',
		'left: 18%',
		'top: 35%',
		'pointer-events:none',
	].join(';');
	cutStage.appendChild(blade);

	const cutSide = document.createElement('div');
	cutSide.style.cssText = [
		'background:rgba(255,255,255,0.04)',
		'border:1px solid rgba(255,255,255,0.08)',
		'border-radius:12px',
		'padding:12px',
	].join(';');

	const stabilityBarOuter = document.createElement('div');
	stabilityBarOuter.style.cssText = 'height:12px;border-radius:999px;background:rgba(255,255,255,0.10);overflow:hidden;border:1px solid rgba(255,255,255,0.10)';
	const stabilityBarInner = document.createElement('div');
	stabilityBarInner.style.cssText = 'height:100%;width:100%;background:linear-gradient(90deg,#22c55e,#f59e0b,#ef4444);transform-origin:left center;transform:scaleX(0.0);';
	stabilityBarOuter.appendChild(stabilityBarInner);

	const cutInfo = document.createElement('div');
	cutInfo.style.cssText = 'margin-top:10px;color:#ddd;font-size:13px;white-space:pre-line;line-height:1.4;';
	const cutScoreEl = document.createElement('div');
	cutScoreEl.style.cssText = 'margin-top:10px;font-weight:900;color:#ffd700;';

	const cutDoneBtn = document.createElement('button');
	cutDoneBtn.className = 'btn';
	cutDoneBtn.textContent = 'Terminer la découpe';
	cutDoneBtn.style.cssText = 'margin-top:12px;width:100%;min-height:40px;';
	cutDoneBtn.disabled = true;

	const cutLabel = document.createElement('div');
	cutLabel.style.cssText = 'font-weight:800;color:#ddd;margin-bottom:8px;';
	cutLabel.textContent = 'Stabilité / Déviation';
	cutSide.appendChild(cutLabel);
	cutSide.appendChild(stabilityBarOuter);
	cutSide.appendChild(cutInfo);
	cutSide.appendChild(cutScoreEl);
	cutSide.appendChild(cutDoneBtn);

	cutWrap.appendChild(cutStage);
	cutWrap.appendChild(cutSide);
	panel.appendChild(cutWrap);

	const ctx = canvas.getContext('2d');
	if (!ctx) {
		cancelled = true;
		try { options.onCancel?.(); } catch { /* noop */ }
		safeCleanup();
		return null;
	}

	const idealPath = [
		{ x: 0.18, y: 0.35 },
		{ x: 0.30, y: 0.30 },
		{ x: 0.42, y: 0.36 },
		{ x: 0.55, y: 0.58 },
		{ x: 0.70, y: 0.62 },
		{ x: 0.82, y: 0.48 },
	];

	const getStageSize = () => {
		const r = cutStage.getBoundingClientRect();
		return { w: r.width, h: r.height };
	};

	const toPx = (p: { x: number; y: number }, size: { w: number; h: number }) => ({ x: p.x * size.w, y: p.y * size.h });

	const drawTemplate = () => {
		const size = getStageSize();
		canvas.width = Math.max(1, Math.floor(size.w * devicePixelRatio));
		canvas.height = Math.max(1, Math.floor(size.h * devicePixelRatio));
		ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

		ctx.clearRect(0, 0, size.w, size.h);
		const pts = idealPath.map(p => toPx(p, size));
		const corridor = 18;

		// corridor glow (approx) by thick stroke
		ctx.save();
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.strokeStyle = 'rgba(110,231,255,0.12)';
		ctx.lineWidth = corridor * 2;
		ctx.beginPath();
		for (let i = 0; i < pts.length; i++) {
			const p = pts[i];
			if (!p) continue;
			if (i === 0) ctx.moveTo(p.x, p.y);
			else ctx.lineTo(p.x, p.y);
		}
		ctx.stroke();
		ctx.restore();

		// dashed ideal line
		ctx.save();
		ctx.setLineDash([8, 10]);
		ctx.strokeStyle = 'rgba(255,255,255,0.65)';
		ctx.lineWidth = 2;
		ctx.beginPath();
		for (let i = 0; i < pts.length; i++) {
			const p = pts[i];
			if (!p) continue;
			if (i === 0) ctx.moveTo(p.x, p.y);
			else ctx.lineTo(p.x, p.y);
		}
		ctx.stroke();
		ctx.restore();

		// A / B markers
		const A = pts[0];
		const B = pts[pts.length - 1];
		if (A && B) {
			const drawMarker = (p: { x: number; y: number }, label: string, color: string) => {
				ctx.save();
				ctx.fillStyle = color;
				ctx.strokeStyle = 'rgba(0,0,0,0.55)';
				ctx.lineWidth = 2;
				ctx.beginPath();
				ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
				ctx.fill();
				ctx.stroke();
				ctx.fillStyle = '#fff';
				ctx.font = '900 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				ctx.fillText(label, p.x, p.y);
				ctx.restore();
			};
			drawMarker(A, 'A', '#22c55e');
			drawMarker(B, 'B', '#f59e0b');
		}
	};

	drawTemplate();
	window.addEventListener('resize', drawTemplate);

	// Cut tracking
	type Sample = { x: number; y: number; t: number };
	const samples: Sample[] = [];
	let cutPointerId: number | null = null;
	let cutStarted = false;
	let maxProgress = 0;
	let cutStartedAtA = false;
	const startRadius = 26;
	const endRadius = 28;
	const resumeRadius = 44;
	let lastRawPoint: { x: number; y: number; t: number } | null = null;
	const cutTremorPhase = (tremorSeed % 997) * 0.017 + 1.0;

	const getPointerXY = (e: PointerEvent) => {
		const r = cutStage.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	};

	const computeProgressAlongPath = (x: number, y: number, pts: Array<{ x: number; y: number }>): number => {
		let totalLen = 0;
		for (let i = 0; i < pts.length - 1; i++) {
			const a = pts[i];
			const b = pts[i + 1];
			if (!a || !b) continue;
			totalLen += Math.hypot(b.x - a.x, b.y - a.y);
		}
		if (totalLen <= 1e-9) return 0;

		let bestDist = Number.POSITIVE_INFINITY;
		let bestS = 0;
		let cum = 0;
		for (let i = 0; i < pts.length - 1; i++) {
			const a = pts[i];
			const b = pts[i + 1];
			if (!a || !b) continue;
			const abx = b.x - a.x;
			const aby = b.y - a.y;
			const abLen = Math.hypot(abx, aby);
			if (abLen <= 1e-9) continue;
			const apx = x - a.x;
			const apy = y - a.y;
			let t = (apx * abx + apy * aby) / (abLen * abLen);
			t = clamp(t, 0, 1);
			const cx = a.x + abx * t;
			const cy = a.y + aby * t;
			const dist = Math.hypot(x - cx, y - cy);
			const s = (cum + t * abLen) / totalLen;
			if (dist < bestDist) { bestDist = dist; bestS = s; }
			cum += abLen;
		}
		return clamp(bestS, 0, 1);
	};

	const computeCutPhase = (): SewingCutPhaseResult => {
		const size = getStageSize();
		const pts = idealPath.map(p => toPx(p, size));
		const maxAllowedDistance = 18;
		const distances: number[] = [];
		let outside = 0;

		for (const s of samples) {
			let best = Number.POSITIVE_INFINITY;
			for (let i = 0; i < pts.length - 1; i++) {
				const a = pts[i];
				const b = pts[i + 1];
				if (!a || !b) continue;
				const d = distancePointToSegment(s.x, s.y, a.x, a.y, b.x, b.y);
				if (d < best) best = d;
			}
			distances.push(best);
			if (best > maxAllowedDistance) outside++;
		}

		const { mean, std } = computeMeanAndStd(distances);
		const devNorm = clamp(mean / maxAllowedDistance, 0, 1);
		const maxSigma = 14;
		const instabNorm = clamp(std / maxSigma, 0, 1);
		const outPct = samples.length ? (outside / samples.length) : 1;

		const w1 = 0.45, w2 = 0.45, w3 = 0.10;
		const score = 100 * clamp(1 - (w1 * devNorm + w2 * instabNorm + w3 * outPct), 0, 1);
		const partialFailThreshold = 0.35;
		const partialFail = outPct > partialFailThreshold;

		return {
			samples: samples.length,
			meanDistancePx: mean,
			stdDistancePx: std,
			outsidePercent: outPct,
			score,
			partialFail,
		};
	};

	const redrawPathOverlay = () => {
		drawTemplate();
		const size = getStageSize();
		const pts = idealPath.map(p => toPx(p, size));
		const maxAllowedDistance = 18;
		const A = pts[0];
		const B = pts[pts.length - 1];

		// draw traced path, red if out of corridor
		ctx.save();
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.lineWidth = 3;
		for (let i = 1; i < samples.length; i++) {
			const a = samples[i - 1];
			const b = samples[i];
			if (!a || !b) continue;
			// decide color based on distance at b
			let best = Number.POSITIVE_INFINITY;
			for (let j = 0; j < pts.length - 1; j++) {
				const p0 = pts[j];
				const p1 = pts[j + 1];
				if (!p0 || !p1) continue;
				const d = distancePointToSegment(b.x, b.y, p0.x, p0.y, p1.x, p1.y);
				if (d < best) best = d;
			}
			ctx.strokeStyle = best > maxAllowedDistance ? 'rgba(239,68,68,0.95)' : 'rgba(255,255,255,0.90)';
			ctx.beginPath();
			ctx.moveTo(a.x, a.y);
			ctx.lineTo(b.x, b.y);
			ctx.stroke();
		}
		ctx.restore();

		const r = computeCutPhase();
		const devNorm = clamp(r.meanDistancePx / 18, 0, 1);
		const instabNorm = clamp(r.stdDistancePx / 14, 0, 1);
		const meter = clamp(1 - (0.5 * devNorm + 0.5 * instabNorm), 0, 1);
		stabilityBarInner.style.transform = `scaleX(${meter.toFixed(3)})`;

		const last = samples.length ? samples[samples.length - 1] : null;
		let canFinish = false;
		if (cutStartedAtA && last && B) {
			const distToB = Math.hypot(last.x - B.x, last.y - B.y);
			canFinish = (maxProgress >= 0.97) && (distToB <= endRadius);
		}
		cutDoneBtn.disabled = !canFinish;

		cutInfo.textContent = [
			`Échantillons: ${r.samples}`,
			`Déviation moyenne: ${r.meanDistancePx.toFixed(1)} px`,
			`Instabilité (σ): ${r.stdDistancePx.toFixed(1)} px`,
			`Hors gabarit: ${fmtPct(r.outsidePercent)}`,
			`Progression A→B: ${(maxProgress * 100).toFixed(0)}%`,
			'',
			cutStartedAtA ? '' : 'Commence au point A (cercle vert).',
			(canFinish ? 'OK: tu as atteint le point B.' : 'Objectif: rejoindre B (cercle orange).'),
			r.partialFail ? '' : 'OK: tu restes assez dans le gabarit.',
			r.partialFail ? 'ÉCHEC PARTIEL: trop de sorties (matériaux perdus).' : '',
			'',
			'Conseils:',
			'- prends ton temps, évite les zig-zags',
			'- vise le centre de la zone bleutée',
		].filter(Boolean).join('\n');
		cutScoreEl.textContent = `Score Découpe: ${r.score.toFixed(1)} / 100`;
	};

	const onCutPointerDown = (e: PointerEvent) => {
		if (cancelled) return;
		e.preventDefault();
		const raw = getPointerXY(e);
		const size = getStageSize();
		const pts = idealPath.map(pp => toPx(pp, size));
		const A = pts[0];
		const last = samples.length ? samples[samples.length - 1] : null;

		if (!cutStarted) {
			if (!A) return;
			const distToA = Math.hypot(raw.x - A.x, raw.y - A.y);
			if (distToA > startRadius) {
				cutStartedAtA = false;
				repaintSoon();
				return;
			}
			cutStartedAtA = true;
			cutStarted = true;
			samples.length = 0;
			maxProgress = 0;
			// SFX: play pre-cut sound on first start
			try { (window as any).game?.audioManager?.play('couture_predecoupe'); } catch { /* noop */ }
		} else {
			// Allow resuming, but only near the last point to avoid "teleport".
			if (last) {
				const d = Math.hypot(raw.x - last.x, raw.y - last.y);
				if (d > resumeRadius) { repaintSoon(); return; }
			}
		}

		const now = performance.now();
		const speed01 = 0;
		// Stronger tremble on pointer down (accentuated)
		const amp = 2.2 + speed01 * 3.6;
		const tr = tremor2D(now, amp, cutTremorPhase);
		const p = { x: raw.x + tr.dx, y: raw.y + tr.dy }; 

		cutStage.setPointerCapture(e.pointerId);
		cutPointerId = e.pointerId;
		lastRawPoint = { x: raw.x, y: raw.y, t: now };
		samples.push({ x: p.x, y: p.y, t: now });
		maxProgress = Math.max(maxProgress, computeProgressAlongPath(p.x, p.y, pts as any));
		blade.style.left = `${p.x}px`;
		blade.style.top = `${p.y}px`;
		repaintSoon();
	};

	const onCutPointerMove = (e: PointerEvent) => {
		if (cancelled) return;
		if (cutPointerId == null || e.pointerId !== cutPointerId) return;
		const raw = getPointerXY(e);
		const now = performance.now();
		let speed01 = 0;
		if (lastRawPoint) {
			const dt = Math.max(1, now - lastRawPoint.t);
			const dist = Math.hypot(raw.x - lastRawPoint.x, raw.y - lastRawPoint.y);
			const speed = (dist / dt) * 1000; // px/s
			speed01 = clamp(speed / 1400, 0, 1);
		}
		lastRawPoint = { x: raw.x, y: raw.y, t: now };
		// Increase tremor amplitude and make it more sensitive to speed
		const amp = 2.0 + speed01 * 4.0;
		const tr = tremor2D(now, amp, cutTremorPhase);
		const p = { x: raw.x + tr.dx, y: raw.y + tr.dy };
		samples.push({ x: p.x, y: p.y, t: now });
		const size = getStageSize();
		const pts = idealPath.map(pp => toPx(pp, size));
		maxProgress = Math.max(maxProgress, computeProgressAlongPath(p.x, p.y, pts as any));
		blade.style.left = `${p.x}px`;
		blade.style.top = `${p.y}px`;
		repaintSoon();
	};

	const onCutPointerUp = (e: PointerEvent) => {
		if (cutPointerId == null || e.pointerId !== cutPointerId) return;
		cutPointerId = null;
		lastRawPoint = null;
		repaintSoon();
	};

	cutStage.addEventListener('pointerdown', onCutPointerDown);
	cutStage.addEventListener('pointermove', onCutPointerMove);
	cutStage.addEventListener('pointerup', onCutPointerUp);
	cutStage.addEventListener('pointercancel', () => { cutPointerId = null; });

	let repaintRaf: number | null = null;
	const repaintSoon = () => {
		if (repaintRaf != null) return;
		repaintRaf = requestAnimationFrame(() => {
			repaintRaf = null;
			redrawPathOverlay();
		});
	};
	redrawPathOverlay();

	const cutResult = await raceCancel(new Promise<SewingCutPhaseResult>((resolve) => {
		cutDoneBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			// SFX: play cut end sound
			try { (window as any).game?.audioManager?.play('couture_decoupe'); } catch { /* noop */ }
			resolve(computeCutPhase());
		});
	}));

	window.removeEventListener('resize', drawTemplate);
	if (!cutResult || cancelled) { safeCleanup(); return null; }

	// If partial fail: consume mats, no item created, show result screen (no align phases).
	const alignRounds: SewingAlignPhaseResult[] = [];
	// Scoring: per-step contributions (cut max = 10, each align round max = 3.3)
	const CUT_MAX = 10;
	const ALIGN_ROUND_MAX = 3.3;
	const cutContribution = CUT_MAX * (cutResult.score / 100);
	// Alignment contribution mapping: 25% score -> 0 contribution, 100% -> ALIGN_ROUND_MAX. Linear in between.
	const alignContributionFromScore = (score100: number) => {
		// Now: 50% -> 0 contribution, 100% -> full contribution
		if (score100 <= 50) return 0;
		const t = (score100 - 50) / 50; // maps 50..100 -> 0..1
		return ALIGN_ROUND_MAX * clamp(t, 0, 1);
	};
	let totalScore = 14; // will be computed after collecting alignment rounds

	if (!cutResult.partialFail) {
		// -------------------- Phase 2: Align motif / grain (3 rounds) --------------------
		const totalRounds = 3;
		for (let round = 1; round <= totalRounds; round++) {
			setHeader(`Aligner le motif (${round}/${totalRounds})`, 'Drag = déplacer. Shift + drag ou molette = tourner. Objectif: centrer et aligner (0°).');

			const stageWrap = document.createElement('div');
			stageWrap.style.cssText = [
				'margin-top:14px',
				'display:grid',
				'grid-template-columns: 1fr 260px',
				'gap:12px',
				'align-items:start',
			].join(';');

			const fabric = document.createElement('div');
			fabric.style.cssText = [
				'position:relative',
				'height:340px',
				'border-radius:14px',
				'border:1px solid rgba(255,255,255,0.10)',
			'background: linear-gradient(0deg, rgba(255,255,255,0.02), rgba(255,255,255,0.02))',
				'overflow:hidden',
				'touch-action:none',
			].join(';');

			const centerCross = document.createElement('div');
			centerCross.style.cssText = [
				'position:absolute',
				'left:50%',
				'top:50%',
				'width:0',
				'height:0',
				'pointer-events:none',
			].join(';');
			centerCross.innerHTML = `
				<div style="position:absolute;left:-12px;top:0;width:24px;height:2px;background:#6ee7ff;opacity:0.75"></div>
				<div style="position:absolute;left:0;top:-12px;width:2px;height:24px;background:#6ee7ff;opacity:0.75"></div>
			`;
			fabric.appendChild(centerCross);

			const motif = document.createElement('div');
			motif.style.cssText = [
				'position:absolute',
				'left:50%',
				'top:50%',
				'width:190px',
				'height:120px',
				'border-radius:12px',
				'border:1px dashed rgba(255,255,255,0.55)',
				'background: repeating-linear-gradient(45deg, rgba(255,255,255,0.12) 0, rgba(255,255,255,0.12) 10px, rgba(255,255,255,0.03) 10px, rgba(255,255,255,0.03) 20px)',
				'box-shadow: 0 10px 26px rgba(0,0,0,0.45)',
				'cursor:grab',
				'transform-origin:center center',
				'touch-action:none',
			].join(';');
			fabric.appendChild(motif);

			const side = document.createElement('div');
			side.style.cssText = [
				'background:rgba(255,255,255,0.04)',
				'border:1px solid rgba(255,255,255,0.08)',
				'border-radius:12px',
				'padding:12px',
			].join(';');

			const alignInfo = document.createElement('div');
			alignInfo.style.cssText = 'color:#ddd;font-size:13px;white-space:pre-line;line-height:1.4;';
			const alignReveal = document.createElement('div');
			alignReveal.style.cssText = 'margin-top:10px;font-weight:900;color:#ffd700;display:none;';
			const alignNextBtn = document.createElement('button');
			alignNextBtn.className = 'btn';
			alignNextBtn.textContent = 'Valider alignement';
			alignNextBtn.style.cssText = 'margin-top:12px;width:100%;min-height:40px;';

			side.appendChild(alignInfo);
			side.appendChild(alignReveal);
			side.appendChild(alignNextBtn);

			stageWrap.appendChild(fabric);
			stageWrap.appendChild(side);
			panel.appendChild(stageWrap);

			// Alignment state: start NOT already correct
			let translateX = 0;
			let translateY = 0;
			let rotationDeg = 0;
			for (let tries = 0; tries < 6; tries++) {
				translateX = rand(-160, 160);
				translateY = rand(-105, 105);
				rotationDeg = rand(-26, 26);
				if (Math.hypot(translateX, translateY) > 35 || Math.abs(rotationDeg) > 7) break;
			}
			let dragPointerId: number | null = null;
			let dragStartClient = { x: 0, y: 0 };
			let dragStartTranslate = { x: 0, y: 0 };
			let dragStartRotationDeg = 0;
			const alignTremorPhase = ((tremorSeed % 1009) * 0.013) + round * 3.17;
			let alignAnimating = true;

			const getFabricRect = () => fabric.getBoundingClientRect();
		// Tremor amplitude and impact settings (adjustable)
		const alignTransAmp = 12.0;
		const alignRotAmp = 4.0;
		const alignTremorImpact = 1.0; // 0: no scoring impact, 1: full impact
		const applyMotifTransform = (nowMs = performance.now()) => {
			// Visual tremor uses amplitudes; scoring will sample the same tremor multiplied by impact
			const tr = tremor2D(nowMs, alignTransAmp, alignTremorPhase);
			motif.style.transform = `translate(calc(-50% + ${translateX + tr.dx}px), calc(-50% + ${translateY + tr.dy}px)) rotate(${rotationDeg}deg)`;
			};
			applyMotifTransform();
			requestAnimationFrame(function tick() {
				if (cancelled || !alignAnimating) return;
				applyMotifTransform();
				requestAnimationFrame(tick);
			});

			const computeAlignPhase = (): SewingAlignPhaseResult => {
				const rect = getFabricRect();
				const diag = Math.hypot(rect.width, rect.height);
				const maxTransl = diag * 0.22;
				const maxRot = 28;
			// Sample instantaneous tremor so tremor affects the score at the moment of validation
			const nowMs = performance.now();
			const trem = tremor2D(nowMs, alignTransAmp, alignTremorPhase);
			const effX = translateX + trem.dx * alignTremorImpact;
			const effY = translateY + trem.dy * alignTremorImpact;
			const translationErrorPx = Math.hypot(effX, effY);
			const rotationErrorDeg = Math.abs((((rotationDeg % 360) + 540) % 360) - 180);
			const rotForScore = Math.min(rotationErrorDeg, 180);

			const motifW = 190;
			const motifH = 120;
			const motifRect = { x: rect.width / 2 + effX - motifW / 2, y: rect.height / 2 + effY - motifH / 2, w: motifW, h: motifH };
			const fabricRect = { x: 0, y: 0, w: rect.width, h: rect.height };
			const overlapArea = rectIntersectionArea(motifRect, fabricRect);
			const overlapPercent = clamp(overlapArea / (motifW * motifH), 0, 1);

			const tNorm = clamp(translationErrorPx / maxTransl, 0, 1);
			const rNorm = clamp(rotForScore / maxRot, 0, 1);
			const a = 0.5, b = 0.4, c = 0.1;
			const rawScore = 100 * clamp(1 - (a * tNorm + b * rNorm + c * (1 - overlapPercent)), 0, 1);
			// Remap alignment score so that 50% -> 0 and 100% -> 100 (linear). Values <=50 -> 0.
			const score = rawScore <= 50 ? 0 : clamp((rawScore - 50) * 2, 0, 100);
			return {
				finalTranslatePx: { x: effX, y: effY },
				finalRotationDeg: rotationDeg,
				translationErrorPx,
				rotationErrorDeg: rotForScore,
				overlapPercent,
				score,
			};
		};

			const updateAlignUI = () => {
				const r = computeAlignPhase();
				alignInfo.textContent = [
					`Centrage: ${r.translationErrorPx.toFixed(1)} px`,
					`Rotation: ${r.rotationErrorDeg.toFixed(1)}°`,
					`Motif dans le tissu: ${fmtPct(r.overlapPercent)}`,
					'',
					'Conseils:',
					'- vise le centre (croix bleue)',
					'- vise 0° (motif horizontal)',
					'',
					'Score masqué pendant la phase.',
				].join('\n');
			};
			updateAlignUI();

			motif.addEventListener('pointerdown', (e) => {
				e.preventDefault();
				if (cancelled) return;
				motif.setPointerCapture(e.pointerId);
				dragPointerId = e.pointerId;
				dragStartClient = { x: e.clientX, y: e.clientY };
				dragStartTranslate = { x: translateX, y: translateY };
				dragStartRotationDeg = rotationDeg;
				motif.style.cursor = 'grabbing';
			});

			motif.addEventListener('pointermove', (e) => {
				if (cancelled) return;
				if (dragPointerId == null || e.pointerId !== dragPointerId) return;
				const dx = e.clientX - dragStartClient.x;
				const dy = e.clientY - dragStartClient.y;
				if (e.shiftKey) {
					rotationDeg = dragStartRotationDeg + dx * 0.18;
				} else {
					translateX = dragStartTranslate.x + dx;
					translateY = dragStartTranslate.y + dy;
				}
				applyMotifTransform();
				updateAlignUI();
			});

			motif.addEventListener('pointerup', (e) => {
				if (dragPointerId == null || e.pointerId !== dragPointerId) return;
				dragPointerId = null;
				motif.style.cursor = 'grab';
				updateAlignUI();
			});

			motif.addEventListener('pointercancel', () => {
				dragPointerId = null;
				motif.style.cursor = 'grab';
			});

			motif.addEventListener('wheel', (e) => {
				if (cancelled) return;
				e.preventDefault();
				rotationDeg += (e.deltaY > 0 ? 1 : -1) * 2.2;
				applyMotifTransform();
				updateAlignUI();
			}, { passive: false });

			const roundRes = await raceCancel(new Promise<SewingAlignPhaseResult>((resolve) => {
				alignNextBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					// SFX: play alignment validation sound
					try { (window as any).game?.audioManager?.play('couture_alignement'); } catch { /* noop */ }
					resolve(computeAlignPhase());
				});
			}));
			if (!roundRes || cancelled) { safeCleanup(); return null; }
			alignAnimating = false;

			// Reveal score briefly (1s) then continue.
			alignReveal.style.display = 'block';
			alignReveal.textContent = `Score Alignement: ${roundRes.score.toFixed(1)} / 100`;
			alignNextBtn.disabled = true;
			await raceCancel(waitMs(1000));
			if (cancelled) { safeCleanup(); return null; }

			alignRounds.push(roundRes);
		}
		// end if (!cutResult.partialFail)
	}

	const alignContributions = alignRounds.map(r => alignContributionFromScore(r.score));
	const totalBonus = cutContribution + alignContributions.reduce((a, b) => a + b, 0);
	totalScore = totalBonus; // base is 0 for now: totalScore equals the sum of contributions
	const result: SewingMinigameResult = {
		alignRounds,
		cut: cutResult,
		cutContribution,
		alignContributions: alignRounds.map(r => alignContributionFromScore(r.score)),
		totalScore,
	};

	let createdName = '';
	let probs: QualityProbabilities = [1, 0, 0, 0, 0];
	let chosenQuality = 1;
	let crafted = false;
	if (cutResult.partialFail) {
		try { options.onPartialFail?.(result); } catch { /* noop */ }
		createdName = '—';
		crafted = false;
	} else {
		({ probs, chosenQuality } = computeQualityFromScore14_20(totalScore));
		try {
			const craftResult = await options.onCraft(result, probs, chosenQuality);
			createdName = String((craftResult as any)?.itemName ?? 'Objet');
			crafted = true;
		} catch {
			createdName = 'Objet';
			crafted = true;
		}
	}

	// -------------------- Final results --------------------
	panel.innerHTML = `
		<div style="display:flex;align-items:flex-start;gap:12px;justify-content:space-between;">
			<div>
				<div style="font-weight:950;font-size:18px;">Couture — Résultat</div>
				<div style="color:#bbb;font-size:12px;margin-top:3px;">${crafted ? `Objet créé: <span style=\"color:#fff;font-weight:800;\">${createdName}</span>` : `Objet créé: <span style=\"color:#fff;font-weight:800;\">—</span>`}</div>
				<div style="color:#999;font-size:12px;margin-top:6px;">Recette: <span style="color:#fff;font-weight:800;">${options.recipeLabel}</span></div>
			</div>
			<button class="btn" id="sewingMinigameDoneBtn" style="min-width:120px;">Fermer</button>
		</div>

		<div style="margin-top:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px;">
			<div style="font-weight:900;color:#ffd700;">Score de fabrication: ${totalScore.toFixed(2)}</div>
			<div style="color:#bbb;font-size:12px;margin-top:6px;">(Score 14..20 = 14 + 6 * moyenne phases)</div>
			<div id="sewingMinigameBreakdown" style="margin-top:8px;color:#ddd;font-size:13px;white-space:pre-line;"></div>
			<div id="sewingMinigameQuality" style="margin-top:8px;color:#ddd;font-size:13px;white-space:pre-line;"></div>
		</div>
	`;

	const breakdownEl = panel.querySelector('#sewingMinigameBreakdown') as HTMLDivElement | null;
	if (breakdownEl) {
		const lines: string[] = [];
		lines.push(`Découpe: ${cutResult.score.toFixed(1)} / 100 → +${cutContribution.toFixed(2)} (dev ${cutResult.meanDistancePx.toFixed(1)}px, σ ${cutResult.stdDistancePx.toFixed(1)}px, hors ${fmtPct(cutResult.outsidePercent)})`);
		if (alignRounds.length) {
			lines.push(`Alignements (x${alignRounds.length}):`);
			for (let i = 0; i < alignRounds.length; i++) {
				const r = alignRounds[i];
				if (!r) continue;
				const contrib = alignContributionFromScore(r.score);
				lines.push(`  - ${i + 1}: ${r.score.toFixed(1)} / 100 → +${contrib.toFixed(2)} (centre ${r.translationErrorPx.toFixed(0)}px)`);
			}
			lines.push('(50% de précision = +0 ; 100% = +3.3 ; contributions additionnées au bonus total.)');
		}
		lines.push(`Score final (somme des contributions): ${totalScore.toFixed(2)}`);
		if (cutResult.partialFail) lines.push('⚠ Échec partiel: trop de sorties du gabarit → matériaux perdus, aucun objet créé.');
		breakdownEl.textContent = lines.join('\n');
	}

	const qualEl = panel.querySelector('#sewingMinigameQuality') as HTMLDivElement | null;
	if (qualEl) {
		if (!crafted) {
			qualEl.innerHTML = '<div style="color:#ef4444;font-weight:800;">Qualité: —</div>';
		} else {
			let html = '<div style="font-weight:800;">Chances par qualité:</div>';
			for (let q = 1; q <= probs.length; q++) {
				html += `<div>Q${q}: ${((probs[q - 1] ?? 0) * 100).toFixed(2)}%</div>`;
			}
			html += `<div style="margin-top:8px;font-weight:800;">Qualité obtenue: ${qualityBadgeHtml(chosenQuality)}</div>`;
			qualEl.innerHTML = html;
		}
	}

	(panel.querySelector('#sewingMinigameDoneBtn') as HTMLButtonElement | null)?.addEventListener('click', (e) => {
		e.stopPropagation();
		safeCleanup();
	});

	return result;
}
