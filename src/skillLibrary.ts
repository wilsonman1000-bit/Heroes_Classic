import {
    BuffSkill,
    Damageskill,
    DebuffSkill,
    DefenseSkill,
    DoTSkill,
    Healskill,
    HoTSkill,
    LifeDrainSkill,
    ManaSkill,
    ActionPointSkill,
    MovementSkill,
    ManaRegenBuffSkill,
    ManaRegenDebuffSkill,
    Skill,
    VulnerabilitySkill,
} from './skill.js';

export type SkillCategory = 'guerrier' | 'mage' | 'voleur';

export type SkillMeta = {
    category: SkillCategory;
    cooldownTurns?: number;
};

export type SkillId =
    | 'basic_attack'
    | 'block'
    | 'mana_gain'
    | 'tir_a_l_arc'
    | 'shuriken'
    | 'master_attack'
    // Skill tree
    | 'petit_soin'
    | 'buff_attaque'
    | 'soin'
    | 'malediction'
    | 'boule_de_feu'
    | 'eclair'
    | 'brulure'
    | 'hache_lourde'
    | 'poison'
    | 'buff_permanent'
    | 'debuff_attaque'
    | 'regeneration'
    | 'buff_regen_mana'
    | 'boule_de_givre'
    | 'debuff_permanent'
    | 'drain_de_vie'
    | 'grand_soin'
    | 'missile_magique'
    | 'marque_vulnerante'
    | 'fragiliser'
    | 'rayon_de_feu'
    | 'ralentissement'
    | 'mana_groupe'
    | 'gain_pa_groupe'
    | 'couteau_magique'
    | 'tir_gobelin'
    // Déplacement (plateau)
    | 'teleportation'
    | 'assassinat'
    | 'lancer_allie'
    | 'lancer_ennemi'
    | 'double_crochet'
    | 'charge'
    | 'mouvement_de_fou'
    | 'repouser'
    | 'bombe_fumigene'
    | 'immobiliser'
    | 'harpon_chaine'
    | 'fureur';

export type SkillOverrides = Partial<{
    // Choice / Skill base
    key: string;
    description: string;
    name: string;
    manaCost: number;
    cooldownTurns: number;

    // Subclasses
    damage: number;
    heal: number;
    buffAmount: number;
    debuffAmount: number;
    duration: number;
    damagePerTurn: number;
    healPerTurn: number;
    defenseAmount: number;
    vulnerabilityAmount: number;
    hits: number;
}>;

type SkillFactory = () => Skill;

const SKILL_META: Record<SkillId, SkillMeta> = {
    // Base
    basic_attack: { category: 'guerrier' },
    block: { category: 'guerrier' },
    mana_gain: { category: 'mage' },
    tir_a_l_arc: { category: 'voleur', cooldownTurns: 1 },
    shuriken: { category: 'voleur', cooldownTurns: 1 },
    master_attack: { category: 'guerrier' },

    // Mage
    missile_magique: { category: 'mage' },
    boule_de_feu: { category: 'mage' },
    brulure: { category: 'mage', cooldownTurns: 1 },
    malediction: { category: 'mage' },
    buff_regen_mana: { category: 'mage', cooldownTurns: 1 },
    boule_de_givre: { category: 'mage', cooldownTurns: 1 },
    eclair: { category: 'mage', cooldownTurns: 1 },
    ralentissement: { category: 'mage', cooldownTurns: 1 },
    mana_groupe: { category: 'mage', cooldownTurns: 0 },
    gain_pa_groupe: { category: 'voleur', cooldownTurns: 2 },
    couteau_magique: { category: 'mage', cooldownTurns: 0 },
    tir_gobelin: { category: 'voleur', cooldownTurns: 0 },

    // Soins (classés Mage pour l’instant)
    petit_soin: { category: 'mage' },
    soin: { category: 'mage' },
    regeneration: { category: 'mage', cooldownTurns: 1 },
    grand_soin: { category: 'mage', cooldownTurns: 1 },

    // Guerrier
    buff_attaque: { category: 'guerrier' },
    hache_lourde: { category: 'guerrier' },
    buff_permanent: { category: 'guerrier' },
    marque_vulnerante: { category: 'guerrier', cooldownTurns: 1 },

    // Voleur
    poison: { category: 'voleur' },
    debuff_attaque: { category: 'voleur' },
    debuff_permanent: { category: 'voleur' },
    drain_de_vie: { category: 'voleur', cooldownTurns: 1 },
    fragiliser: { category: 'voleur', cooldownTurns: 1 },

    // Mage (plateau / directionnel)
    rayon_de_feu: { category: 'mage', cooldownTurns: 0 },

    // Déplacement (plateau)
    teleportation: { category: 'mage', cooldownTurns: 1 },
    assassinat: { category: 'voleur', cooldownTurns: 0 },
    lancer_allie: { category: 'guerrier', cooldownTurns: 1 },
    lancer_ennemi: { category: 'guerrier', cooldownTurns: 1 },
    double_crochet: { category: 'guerrier', cooldownTurns: 0 },
    charge: { category: 'guerrier', cooldownTurns: 1 },
    mouvement_de_fou: { category: 'voleur', cooldownTurns: 0 },
    repouser: { category: 'guerrier', cooldownTurns: 1 },
    bombe_fumigene: { category: 'voleur', cooldownTurns: 1 },
    immobiliser: { category: 'voleur', cooldownTurns: 1 },
    harpon_chaine: { category: 'guerrier', cooldownTurns: 2 },
    // Fureur: sacrifice 10% PV max pour gagner 1 PA (portée: soi-même)
    fureur: { category: 'guerrier' },
};

const SKILL_FACTORIES: Record<SkillId, SkillFactory> = {
    missile_magique: () => {
        const s = new Damageskill('MM', 'Lance un missile magique rapide (portée 6, cercle).', 'Missile magique', 0.8, 20, 0);
        (s as any).tactical = { kind: 'single', range: 6, aim: 'circle' };
        return s;
    },
    basic_attack: () => new Damageskill('A', 'Fait une attaque de base', 'Attaque de base', 1.0, 20, 1),
    block: () => new DefenseSkill('B', 'Réduit les dégâts reçus de 50% pendant 1 tour', 'Blocage', 0.5, 1, 0, 1),
    mana_gain: () => new ManaSkill('M', 'Régénère 20 mana', 'Gain de mana', 0, 1),
    tir_a_l_arc: () => {
        const s = new Damageskill(
            'ARC',
            "Tir à l'arc à distance (200% de l'attaque). Portée 4 en carré. Bonus: +20% chance de coup critique si la cible est sur une diagonale.",
            "Tir à l'arc",
            2.0,
            25,
            2
        );
        // Projectile: ne peut pas viser derrière une unité (bloqué par la première unité sur la trajectoire)
        // Aim square = Chebyshev distance (carré) pour autoriser toutes les directions.
        (s as any).tactical = { kind: 'single', aim: 'square', range: 4, stopAtFirstUnit: true, diagonalCritBonus: 0.2 };
        return s;
    },
    shuriken: () => {
        const s = new Damageskill('TA', "Lance un shuriken à distance (80% de l'attaque). Portée diagonale (portée 4). CD 1.", "Shuriken", 0.8, 20, 1);
        // Projectile: ne peut pas viser derrière une unité (bloqué par la première unité sur la trajectoire)
        (s as any).tactical = { kind: 'single', aim: 'diagonal', range: 4, stopAtFirstUnit: true };
        return s;
    },

    tir_gobelin: () => {
        const s = new Damageskill(
            'TG',
            'Tir à distance du gobelin archer (portée 7, orthogonal).',
            'Tir gobelin',
            1.0,
            10,
            1
        );
        // Projectile: ne peut pas viser derrière une unité
        (s as any).tactical = { kind: 'single', range: 7, aim: 'orthogonal', stopAtFirstUnit: true };
        return s;
    },


    master_attack: () => new Damageskill('A', 'Attaque du maître', 'Attaque du maître', 1, 0, 1),

    petit_soin: () => new Healskill('F', 'Soigne un peu vos PV', 'Petit soin', 0.5, 10, 1),
    buff_attaque: () => new BuffSkill('H', 'Augmente votre attaque', 'Buff attaque', 0.3, 3, 20, 1),
    soin: () => new Healskill('C', 'Soigne une partie de vos PV', 'Soin', 2, 50, 2),
    malediction: () => new Damageskill('E', 'Utilise la magie noire pour infliger de lourds dégâts et fait perdre 5 mana à l\'adversaire', 'Malédiction', 1.5, 30, 1),
    boule_de_feu: () => new Damageskill('B', 'Envoie une boule de feu', 'Boule de feu', 5.0, 80, 2),
    brulure: () => new DoTSkill('B+', 'Brûlure de la boule de feu', 'Brûlure', 0.8, 3, 40, 1),
    hache_lourde: () => new Damageskill('D', 'Frappe très fort avec une hache', 'Hache lourde', 4, 60, 2),
    poison: () => new DoTSkill('L', 'Inflige des dégâts de poison sur la durée', 'Poison', 0.5, 4, 30, 1),
    buff_regen_mana: () => new ManaRegenBuffSkill('R', 'Augmente regen mana de 10 pendant 3 tours', 'Buff de regen mana', 10, 3, 0, 2),
    boule_de_givre: () => new ManaRegenDebuffSkill('G', 'Réduit la régénération de mana ennemie', 'Boule de Givre', 5, 4, 30, 1),
    buff_permanent: () => new BuffSkill('J', 'Augmente définitivement votre attaque', 'Buff permanent', 0.1, -1, 40, 1),
    debuff_attaque: () => new DebuffSkill('I', "Diminue l'attaque ennemie", 'Débuff attaque', 0.3, 3, 20, 1),
    regeneration: () => new HoTSkill('M', 'Soigne sur la durée', 'Régénération', 0.4, 4, 30, 1),
    debuff_permanent: () => new DebuffSkill('K', "Diminue définitivement l'attaque ennemie", 'Débuff permanent', 0.1, -1, 30, 1),
    // Fureur : sacrifice 10% PV max pour gagner 1 PA (immédiat)
    fureur: () => new ActionPointSkill('FR', 'Sacrifie 10% de vos PV max et gagne 1 PA maintenant.', 'Fureur', 1, 0, 0, 0),
    drain_de_vie: () =>
        new LifeDrainSkill(
            'N',
            'Inflige des dégâts et soigne le lanceur de la même valeur',
            'Drain de vie',
            0.5,
            30,
            1
        ),
    grand_soin: () => new Healskill('G', 'Soigne beaucoup vos PV', 'Grand soin', 2, 40, 1),

    // Vulnérabilité (augmente les dégâts reçus)
    // Guerrier (1 point) : sur les 3 prochaines attaques
    marque_vulnerante: () =>
        new VulnerabilitySkill(
            'V',
            'Augmente les dégâts reçus par la cible sur ses prochaines attaques',
            'Marque vulnérante',
            0.3,
            -1,
            3,
            20,
            1
        ),

    // Voleur (1 point) : pendant 2 tours
    fragiliser: () =>
        new VulnerabilitySkill(
            'F',
            'Augmente les dégâts reçus par la cible pendant une courte durée',
            'Fragiliser',
            0.3,
            3, // durée 3 tours
            0,
            30, // coût mana 30
            1
        ),

    // Mage (niveau 5): rayon directionnel qui touche tous les ennemis dans la direction choisie
    rayon_de_feu: () => {
        const s = new Damageskill(
            'RF',
            "Projette un rayon de feu en ligne droite (orthogonal). Touche tous les ennemis sur 7 cases.",
            'Rayon de feu',
            2.5,
            50,
            2
        );
        (s as any).tactical = { kind: 'beam', range: 7, aim: 'orthogonal' };
        return s;
    },
    ralentissement: () => {
        // Donne 1 PA maintenant et 1 PA au début du prochain tour. Coût: 30 mana, CD:1, coût en PA pour lancer: 0
        return new ActionPointSkill(
            'RT',
            'Donne 1 PA maintenant et 1 PA au début du prochain tour.',
            'Ralentissement du temps',
            1, // amount
            1, // duration (applied next turn)
            30, // mana cost
            0 // action points cost
        );
    },
    mana_groupe: () => {
        // Donne +20 mana à tous les alliés. Coût en PA: 2, pas de coût en mana (0), CD 0
        return new ManaSkill('MG', "Donne +20 mana à tous les alliés", 'Recharge de mana de groupe', 0, 2);
    },
    // Voleur : donne +1 PA à tout le groupe au début du prochain tour (une seule fois)
    gain_pa_groupe: () => {
        return new ActionPointSkill(
            'PG',
            "Ajoute 1 PA à tous les alliés et au lanceur au début de leur prochain tour (une seule fois).",
            "Gain de PA groupe",
            1, // amount
            1, // duration (next turn)
            30, // mana cost
            2 // action points cost
        );
    },
    couteau_magique: () => {
        const s = new Damageskill(
            'CM',
            'Projette un couteau magique en ligne droite. S\'arrête sur la première unité sur la trajectoire.',
            'Couteau magique',
            1.5,
            30,
            1
        );
        (s as any).tactical = { kind: 'projectile', range: 7, aim: 'orthogonal', stopAtFirstUnit: true };
        return s;
    },
    eclair: () => {
        const s = new Damageskill(
            'EL',
            "Frappe une cible à distance autour du lanceur (portée 5, cercle).",
            'Éclair',
            2.5,
            30,
            2
        );
        (s as any).tactical = { kind: 'single', range: 5, aim: 'circle' };
        return s;
    },

    teleportation: () => {
        const s = new MovementSkill(
            'TP',
            'Téléporte le mage sur une case dans les 4 directions (haut/bas/gauche/droite).',
            'Téléportation',
            30,
            2
        );
        (s as any).tactical = { kind: 'teleport', range: 7, aim: 'orthogonal' };
        return s;
    },
    assassinat: () => {
        const s = new Damageskill(
            'AS',
            "Frappe l'ennemi et se téléporte derrière lui (diagonales). Si la cible meurt, le lanceur récupère 50 mana. (CD 0)",
            'Assassinat',
            3.0,
            50,
            1
        );
        (s as any).tactical = { kind: 'assassinate', range: 3, aim: 'diagonal' };
        return s;
    },
    lancer_allie: () => {
        const s = new MovementSkill(
            'LA',
            "Attrape un allié adjacent et le lance. À l'atterrissage, inflige des dégâts autour (rayon 1) et étourdit les ennemis orthogonaux adjacents (portée 1). Coût : 40 mana, 2 PA",
            "Lancer d'allié",
            40,
            2
        );
        (s as any).tactical = { kind: 'throw_ally', range: 4, aim: 'manhattan', damageMult: 2.0, stunRange: 1 };
        return s;
    },
    lancer_ennemi: () => {
        const s = new MovementSkill(
            'LE',
            "Attrape un ennemi adjacent et le lance. À l'atterrissage, inflige 150% de l'attaque du guerrier à la cible lancée et aux ennemis orthogonaux adjacents (portée 1). Coût : 40 mana, 2 PA",
            "Lancer d'ennemi",
            40,
            2
        );
        (s as any).tactical = { kind: 'throw_enemy', range: 3, aim: 'manhattan' };
        return s;
    },

    harpon_chaine: () => {
        const s = new MovementSkill(
            'HC',
            "Sélectionne un ennemi dans un rayon de 3 et le ramène dans une case libre adjacente au guerrier. Réduit l'attaque de la cible de 50% pendant 2 tours.",
            "Harpon chaîne",
            20,
            1
        );
        (s as any).tactical = { kind: 'drag_enemy', range: 3, aim: 'circle' };
        // cooldown defined in SKILL_META
        return s;
    },    double_crochet: () => {
        const s = new Skill(
            'DC',
            "Double crochet : étourdit les ennemis adjacents dans les 4 directions (portée 1). Coût : 60 mana, 2 PA.",
            'Double crochet',
            'damage',
            60,
            2
        );
        (s as any).tactical = { kind: 'area', range: 1, aim: 'manhattan', shape: 'plus' };
        return s;
    },
    charge: () => {
        const s = new MovementSkill(
            'CH',
            "Charge : se déplace sur une case à portée 2 (haut/bas/gauche/droite). Coût : 0 mana, 1 PA, CD 1.",
            'Charge',
            0,
            1
        );
        (s as any).tactical = { kind: 'move', range: 2, aim: 'orthogonal' };
        return s;
    },
    mouvement_de_fou: () => {
        const s = new MovementSkill(
            'MF',
            "Effectue un mouvement d'un seul pas en diagonale (4 directions). Portée : 1. Coût : 0 mana, 1 PA, CD 0.",
            "Mouvement de fou",
            0,
            1
        );
        (s as any).tactical = { kind: 'move', range: 1, aim: 'diagonal_strict' };
        return s;
    },
    repouser: () => {
        const s = new Skill(
            'RP',
            "Pousse l'adversaire d'une case en arrière (si la case derrière est libre). Aucun dégât, la cible perd 1 PA. Coût : 20 mana, 1 PA. (Niveau 2)",
            "Repouser",
            'damage',
            20,
            1
        );
        (s as any).tactical = { kind: 'single', range: 1, aim: 'manhattan' };
        return s;
    },
    bombe_fumigene: () => {
        const s = new Skill(
            'BF',
            "Bombe fumigène : cible une case diagonale à portée 4. Zone: rayon 3 (cercle, cases centrales incluses). Aucun dégât, chaque ennemi touché perd 1 PA au début de son prochain tour. Coût : 40 mana, 1 PA. CD 1.",
            "Bombe fumigène",
            'damage',
            40,
            1
        );
        (s as any).tactical = { kind: 'area', range: 4, aim: 'diagonal', radius: 3, shape: 'circle' };
        return s;
    },

    immobiliser: () => {
        // Immobilise un ennemi pendant 1 tour (diagonale, portée 5)
        const s = new DebuffSkill('IM', "Immobilise la cible pendant 1 tour.", 'Immobiliser', 0, 1, 20, 1);
        (s as any).tactical = { kind: 'single', range: 5, aim: 'diagonal' };
        return s;
    },
};

export function createSkill(id: SkillId, overrides: SkillOverrides = {}): Skill {
    const factory = SKILL_FACTORIES[id];
    const skill = factory();

    // Attach category metadata for prerequisites / UI
    const meta = SKILL_META[id];
    if (meta) {
        (skill as any).category = meta.category;
        (skill as any).skillId = id;
        skill.cooldownTurns = meta.cooldownTurns ?? 0;
    }

    // Apply overrides directly on the instance (used rarely)
    for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) continue;
        (skill as any)[key] = value;
    }

    // Ensure cooldown is always a finite integer >= 0
    skill.cooldownTurns = Math.max(0, Math.floor(Number((skill as any).cooldownTurns ?? 0)));

    return skill;
}

// Attempt to find a canonical skill by id, key or name.
// Returns a created skill instance (with meta applied) or null.
export function findCanonicalSkillByNameOrKey(nameOrKey: string): Skill | null {
    const raw = String(nameOrKey ?? '').trim();
    if (!raw) return null;

    // 1) Direct id lookup (most reliable)
    if ((SKILL_FACTORIES as any)[raw]) return createSkill(raw as any);

    const normalize = (v: string): string => {
        return String(v ?? '')
            .trim()
            .toLowerCase()
            .replace(/[’`]/g, "'")
            .normalize('NFD')
            // remove diacritics
            .replace(/\p{Diacritic}+/gu, '')
            // keep alnum, collapse others to spaces
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    };

    const nRaw = normalize(raw);
    if (!nRaw) return null;

    // 2) Match against normalized id / name / key
    for (const id of Object.keys(SKILL_FACTORIES) as SkillId[]) {
        let candidate: Skill;
        try {
            candidate = createSkill(id);
        } catch {
            continue;
        }

        const nId = normalize(id.replace(/_/g, ' '));
        const nName = normalize((candidate as any).name ?? '');
        const nKey = normalize((candidate as any).key ?? '');

        if (nRaw === nId || nRaw === nName || (nKey && nRaw === nKey)) return createSkill(id);
    }

    // 3) Last chance: substring match (handles cases like “Lancer d’allié” with different apostrophes)
    // Keep it conservative: prefer matching by name/id only.
    for (const id of Object.keys(SKILL_FACTORIES) as SkillId[]) {
        let candidate: Skill;
        try {
            candidate = createSkill(id);
        } catch {
            continue;
        }
        const nId = normalize(id.replace(/_/g, ' '));
        const nName = normalize((candidate as any).name ?? '');
        if ((nName && nRaw.includes(nName)) || (nId && nRaw.includes(nId))) return createSkill(id);
    }

    return null;
}
