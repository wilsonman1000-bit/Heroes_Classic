export type OtherMinigameResult = {
	stepsMax: number;
	stepsUsed: number;
	pairsFound: number;
	points: number;
	completed: boolean;
};

export type RunOtherMinigameOptions = {
	recipeLabel: string;
	/** Called after the minigame ends (success or fail), before showing the final result screen. */
	onCraft: (result: OtherMinigameResult) => Promise<{ itemName: string; craftedCount: number }> | { itemName: string; craftedCount: number };
	onCancel?: () => void;
};

type CardDef = {
	id: number;
	key: string;
	imgSrc: string;
};

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

const shuffleInPlace = <T>(arr: T[]): T[] => {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const tmp = arr[i];
		arr[i] = arr[j] as T;
		arr[j] = tmp as T;
	}
	return arr;
};

const createOverlayRoot = (): { root: HTMLDivElement; panel: HTMLDivElement } => {
	const root = document.createElement('div');
	root.id = 'otherMinigameOverlay';
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
		'touch-action:manipulation',
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

const waitMs = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export async function runOtherMinigame(options: RunOtherMinigameOptions): Promise<OtherMinigameResult | null> {
	const { root, panel } = createOverlayRoot();
	let cancelled = false;
	let ended = false;

	const safeRemove = () => {
		try { root.remove(); } catch { /* noop */ }
	};

	const cancel = () => {
		if (cancelled || ended) return;
		cancelled = true;
		try { options.onCancel?.(); } catch { /* noop */ }
		safeRemove();
	};

	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			e.preventDefault();
			cancel();
		}
	};
	document.addEventListener('keydown', onKeyDown);

	const cleanup = () => {
		document.removeEventListener('keydown', onKeyDown);
		safeRemove();
	};

	const stepsMax = 6;
	const pairsMax = 6;
	let stepsUsed = 0;
	let pairsFound = 0;
	let points = 0;

	const motifs: Array<{ key: string; imgSrc: string; label: string }> = [
		{ key: 'coffre', imgSrc: 'ImagesRPG/imagesobjets/coffre.png', label: 'Coffre' },
		{ key: 'gobelin_archer', imgSrc: 'ImagesRPG/imagespersonnage/gobelin_archer.png', label: 'Gobelin archer' },
		{ key: 'potionsoin', imgSrc: 'ImagesRPG/imagesobjets/potion_vert.png', label: 'Potion de soin' },
		{ key: 'pomme', imgSrc: 'ImagesRPG/imagesobjets/bouclier2.png', label: 'Pomme' },
		{ key: 'epee', imgSrc: 'ImagesRPG/imagesobjets/dague_tier2.png', label: 'Épée' },
		{ key: 'potionmana', imgSrc: 'ImagesRPG/imagesobjets/chope.png', label: 'Potion de mana' },
	];

	const cards: CardDef[] = shuffleInPlace(
		motifs.flatMap((m, idx) => [
			{ id: idx * 2 + 0, key: m.key, imgSrc: m.imgSrc },
			{ id: idx * 2 + 1, key: m.key, imgSrc: m.imgSrc },
		]),
	);

	const closeBtnId = 'otherMinigameCloseBtn';
	panel.innerHTML = `
		<div style="display:flex;align-items:flex-start;gap:12px;justify-content:space-between;">
			<div>
				<div style="font-weight:950;font-size:18px;">Fabrication — Jeu de paires</div>
				<div style="color:#bbb;font-size:12px;margin-top:3px;">Recette: <span style="color:#fff;font-weight:800;">${options.recipeLabel}</span></div>
				<div style="color:#999;font-size:12px;margin-top:6px;">${stepsMax} étapes • Retourne 2 cartes par étape • 1 paire = 1 point</div>
			</div>
			<button class="btn" id="${closeBtnId}" style="min-width:110px;">Annuler</button>
		</div>
		<div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
			<div id="otherMinigameHud" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;"></div>
		</div>
		<div style="margin-top:12px;display:grid;grid-template-columns:repeat(4, 1fr);gap:10px;">
			<div id="otherMinigameGrid" style="display:contents;"></div>
		</div>
		<div id="otherMinigameHint" style="margin-top:12px;color:#ddd;font-size:13px;line-height:1.35;"></div>
	`;

	(panel.querySelector(`#${closeBtnId}`) as HTMLButtonElement | null)?.addEventListener('click', (e) => {
		e.stopPropagation();
		cancel();
	});

	const hudEl = panel.querySelector('#otherMinigameHud') as HTMLDivElement | null;
	const gridEl = panel.querySelector('#otherMinigameGrid') as HTMLDivElement | null;
	const hintEl = panel.querySelector('#otherMinigameHint') as HTMLDivElement | null;

	const updateHud = () => {
		if (!hudEl) return;
		const stepsLeft = Math.max(0, stepsMax - stepsUsed);
		hudEl.innerHTML = `
			<div style="background:rgba(255,255,255,0.06);padding:8px 10px;border-radius:10px;">Étapes: <b>${stepsUsed}</b> / ${stepsMax}</div>
			<div style="background:rgba(255,255,255,0.06);padding:8px 10px;border-radius:10px;">Restantes: <b>${stepsLeft}</b></div>
			<div style="background:rgba(255,255,255,0.06);padding:8px 10px;border-radius:10px;">Paires: <b>${pairsFound}</b></div>
			<div style="background:rgba(255,255,255,0.06);padding:8px 10px;border-radius:10px;">Points: <b>${points}</b></div>
		`;
	};

	const setHint = (html: string) => {
		if (hintEl) hintEl.innerHTML = html;
	};

	updateHud();
	setHint('Clique sur deux cartes pour tenter de trouver une paire.');

	if (!gridEl) {
		cleanup();
		return null;
	}

	// UI state
	const matched = new Set<number>();
	const revealed = new Set<number>();
	let pickA: number | null = null;
	let pickB: number | null = null;
	let locked = false;

	const cardButtons: HTMLButtonElement[] = [];

	const renderCard = (idx: number) => {
		const c = cards[idx];
		const isMatched = matched.has(idx);
		const isFaceUp = revealed.has(idx) || isMatched;

		const btn = cardButtons[idx];
		if (!btn) return;
		btn.disabled = cancelled || ended || locked || isMatched;
		btn.setAttribute('aria-pressed', isFaceUp ? 'true' : 'false');

		btn.innerHTML = '';
		btn.style.cssText = [
			'width:100%',
			'aspect-ratio: 1 / 1',
			'border-radius:12px',
			'border:1px solid rgba(255,255,255,0.12)',
			'background:rgba(255,255,255,0.04)',
			'padding:0',
			'cursor:pointer',
			'position:relative',
			'overflow:hidden',
			'transition:transform 80ms ease',
			'outline:none',
			'box-shadow:0 10px 24px rgba(0,0,0,0.35)',
			isMatched ? 'box-shadow:0 10px 24px rgba(0,0,0,0.35), 0 0 0 2px rgba(34,197,94,0.35) inset' : '',
		].filter(Boolean).join(';');

		btn.onmouseenter = () => {
			if (btn.disabled) return;
			btn.style.transform = 'translateY(-1px)';
		};
		btn.onmouseleave = () => {
			btn.style.transform = 'none';
		};

		if (!isFaceUp) {
			btn.innerHTML = `
				<div style="position:absolute;inset:0;background:radial-gradient(circle at 30% 30%, rgba(255,255,255,0.10), rgba(255,255,255,0.02) 45%, rgba(0,0,0,0.25));"></div>
				<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:950;color:rgba(255,255,255,0.65);text-shadow:0 6px 18px rgba(0,0,0,0.55);">?</div>
				<div style="position:absolute;inset:10px;border-radius:10px;border:1px dashed rgba(255,255,255,0.18);"></div>
			`;
			return;
		}

		btn.innerHTML = `
			<div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(255,255,255,0.06), rgba(0,0,0,0.25));"></div>
			<img alt="" src="${c?.imgSrc ?? ''}" style="position:absolute;inset:10px;width:calc(100% - 20px);height:calc(100% - 20px);object-fit:contain;filter:drop-shadow(0 8px 18px rgba(0,0,0,0.55));" />
		`;
	};

	const rerenderAll = () => {
		for (let i = 0; i < cards.length; i++) renderCard(i);
		updateHud();
	};

	const tryEnd = async () => {
		if (ended || cancelled) return;
		if (stepsUsed < stepsMax && pairsFound < pairsMax) return;

		ended = true;
		locked = true;
		rerenderAll();

		const result: OtherMinigameResult = {
			stepsMax,
			stepsUsed,
			pairsFound,
			points,
			completed: true,
		};

		let craftInfo: { itemName: string; craftedCount: number } | null = null;
		try {
			craftInfo = await options.onCraft(result);
		} catch {
			craftInfo = { itemName: 'Objet', craftedCount: 0 };
		}

		const craftedCount = Math.max(0, Math.floor(craftInfo?.craftedCount ?? 0));
		const itemName = String(craftInfo?.itemName ?? 'Objet');
		const stepsLeft = Math.max(0, stepsMax - stepsUsed);

		panel.innerHTML = `
			<div style="display:flex;align-items:flex-start;gap:12px;justify-content:space-between;">
				<div>
					<div style="font-weight:950;font-size:18px;">Résultat — Jeu de paires</div>
					<div style="color:#bbb;font-size:12px;margin-top:3px;">Recette: <span style="color:#fff;font-weight:800;">${options.recipeLabel}</span></div>
				</div>
				<button class="btn" id="otherMinigameDoneBtn" style="min-width:120px;">Fermer</button>
			</div>
			<div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:12px;">
				<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px;">
					<div style="font-weight:900;color:#ffd700;">Score</div>
					<div style="margin-top:8px;color:#ddd;font-size:13px;white-space:pre-line;">Paires trouvées: ${pairsFound}\nPoints: ${points}\nÉtapes restantes: ${stepsLeft}</div>
				</div>
				<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px;">
					<div style="font-weight:900;color:#6ee7ff;">Fabrication</div>
					<div style="margin-top:8px;color:#ddd;font-size:13px;white-space:pre-line;">Objets créés: ${craftedCount}\nObjet: ${itemName}</div>
				</div>
			</div>
			<div style="margin-top:12px;color:#999;font-size:12px;">Astuce: mémorise la position des motifs pour optimiser tes ${stepsMax} étapes.</div>
		`;

		(panel.querySelector('#otherMinigameDoneBtn') as HTMLButtonElement | null)?.addEventListener('click', (e) => {
			e.stopPropagation();
			cleanup();
		});
	};

	// Build grid
	for (let i = 0; i < cards.length; i++) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.setAttribute('aria-label', `Carte ${i + 1}`);
		btn.style.cssText = 'appearance:none;-webkit-appearance:none;';
		cardButtons.push(btn);
		gridEl.appendChild(btn);
		btn.addEventListener('click', async () => {
			if (cancelled || ended) return;
			if (locked) return;
			if (matched.has(i)) return;
			if (revealed.has(i)) return;

			revealed.add(i);
			if (pickA == null) {
				pickA = i;
				rerenderAll();
				setHint('Choisis une deuxième carte.');
				return;
			}
			if (pickB == null) {
				pickB = i;
				locked = true;
				stepsUsed = clamp(stepsUsed + 1, 0, stepsMax);
				rerenderAll();

				const a = pickA;
				const b = pickB;
				const aKey = cards[a]?.key ?? '';
				const bKey = cards[b]?.key ?? '';

				if (aKey && bKey && aKey === bKey) {
					matched.add(a);
					matched.add(b);
					pairsFound = clamp(pairsFound + 1, 0, pairsMax);
					points = pairsFound;
					setHint('<span style="color:#22c55e;font-weight:900;">Paire trouvée !</span> Elle reste visible et tu gagnes 1 point.');
					pickA = null;
					pickB = null;
					locked = false;
					rerenderAll();
					await tryEnd();
					return;
				}

				setHint('<span style="color:#f87171;font-weight:900;">Pas une paire.</span> Les cartes vont se remasquer.');
				rerenderAll();
				await waitMs(650);
				revealed.delete(a);
				revealed.delete(b);
				pickA = null;
				pickB = null;
				locked = false;
				rerenderAll();
				await tryEnd();
				return;
			}
		});
	}

	// Initial paint
	rerenderAll();

	try {
		// Keep the promise pending until the overlay is closed or cancelled.
		// Result is returned only on successful end; cancel returns null.
		while (!cancelled && !ended) {
			await waitMs(50);
		}
		if (cancelled) return null;
		return {
			stepsMax,
			stepsUsed,
			pairsFound,
			points,
			completed: true,
		};
	} finally {
		// If ended, cleanup is handled by Done button. If cancelled, cleanup already removed.
		if (cancelled) cleanup();
	}
}
