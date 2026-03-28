import type { Skill } from '../skill.js';

export function playTacticalSkillAudio(skill: Skill, audioManager: { play: (name: string) => unknown }): void {
    const id = String((skill as any).skillId ?? (skill as any).key ?? skill.name);
    const type = String((skill as any).type ?? '');

    // Priorité: skillId, puis type
    if (id === 'missile_magique') {
        audioManager.play('sortaudio');
        return;
    }
    if (id === 'boule_de_feu') {
        audioManager.play('bouledefeu');
        return;
    }
    if (id === 'rayon_de_feu') {
        audioManager.play('bouledefeu');
        return;
    }
    if (id === 'boule_de_givre') {
        audioManager.play('givre');
        return;
    }
    if (id === 'eclair') {
        audioManager.play('eclair');
        return;
    }
    if (id === 'mana_gain' || type === 'mana') {
        audioManager.play('magic');
        return;
    }
    if (id === 'petit_soin' || id === 'soin' || id === 'grand_soin' || type === 'heal' || type === 'hot') {
        audioManager.play('healaudio');
        return;
    }
    if (id === 'basic_attack' || type === 'damage') {
        audioManager.play('attaque');
        return;
    }
    if (id === 'hache_lourde') {
        audioManager.play('hache');
        return;
    }
    if (id === 'brulure' || id === 'poison' || type === 'dot') {
        audioManager.play('attaque');
        return;
    }
    if (id === 'buff_attaque' || id === 'buff_permanent' || type === 'buff') {
        audioManager.play('magic');
        return;
    }
    if (id === 'debuff_attaque' || id === 'debuff_permanent' || type === 'debuff') {
        audioManager.play('riremalefique');
        return;
    }
    if (id === 'block' || type === 'defense') {
        audioManager.play('magic');
        return;
    }
    if (id === 'drain_de_vie') {
        audioManager.play('healaudio');
        return;
    }
    if (id === 'buff_regen_mana') {
        audioManager.play('magic');
        return;
    }
    if (id === 'marque_vulnerante' || id === 'fragiliser' || type === 'vulnerability') {
        audioManager.play('riremalefique');
        return;
    }
}
