
function ask(question: string) {
    console.log(question);
    return 'A';
    // return new Promise(resolve => {
    //     rl.question(question, answer => {
    //         resolve(answer);
    //     });
    // });
}

class Hero {
    public pv: number;
    public attack: number;
    public fureur: boolean;
    public argent: number;

    constructor(pv: number, attack: number, argent: number) {
        this.pv = pv;
        this.attack = attack;
        this.argent = argent;
        this.fureur = false;
    }
}

const gentil = new Hero(500, 12, 0);
const mechant = new Hero(250, 25, 0);

console.log(' RPGGGG 1 VS 1 : Arriverez-vous à battre l"énorme sac à merde champion des ogres , Vous avez 4 attaques : (A)Attaque de 10, (B) +1 dégâts permanent, (C) Soin de 200% dégâts, (D) Debuff attaque de l"ennemi de 1. Découvrez par vous-même quels sont les statistiques de base. ');

let turn: 'gentil' | 'mechant' = 'gentil';
let gagnant: 'gentil' | 'mechant' | undefined;
while (gentil.pv > 0 && mechant.pv > 0) {
    console.log('----------- Tour du ' + turn);
    const response = await ask('-------------(A)Attaque, (B) +1 dégâts, (C) Soin, (D) Debuff attaque de l"ennemi : ');

    if (turn === 'gentil') {
        // COMPETENCES 
        // Attaque normale 
        if (response === 'A') {
            mechant.pv -= gentil.attack;
            console.log('Attaque normale inflige ' + gentil.attack + ' dégâts');
            console.log('Le méchant a maintenant ' + mechant.pv + 'pv');
            if (mechant.pv <= 90 && !mechant.fureur) {
                mechant.attack += 10;
                mechant.fureur = true;
                console.log('RRROOOO Le méchant entre en fureur et voit ses dégâts augmentés de 10');
            }
        }

        // BUFF ATTAQUE 
        if (response === 'B') {
            gentil.attack += 1
            console.log('Le gentil a ' + gentil.attack + 'attack');
        }

        // SOIN
        if (response === 'C') {
            console.log('Vous vous soignez de ' + (gentil.attack + gentil.attack));
            gentil.pv += (gentil.attack + gentil.attack);
            console.log(' Vous avez maintenant' + gentil.pv + 'hp');
        }

        // DEBUFF ATTAQUE ENNEMI
        if (response === 'D') {
            mechant.attack -= 1;
            console.log(' Le méchant a désormais ' + mechant.attack + 'de dégâts')
        }

        if (mechant.pv <= 0) {
            gagnant = 'gentil';
            gentil.argent += 10;
            console.log(' Vous GAGNEZ 10 argent');

        } else {
            turn = 'mechant';
        }
    } else {
        if (response === 'A') {
            gentil.pv -= mechant.attack;
            console.log(' Le méchant inflige ' + mechant.attack + 'dégâts')
            console.log('Le gentil a maintenant ' + gentil.pv + 'pv');
        }
        if (response === 'B') console.log(' Rien ne se passe.');

        if (gentil.pv <= 0) {
            gagnant = 'mechant';
        } else {
            turn = 'gentil';
        }
    }


}
console.log('Le gagnant est ' + gagnant);
console.log(' Vous avez' + gentil.argent + 'argent');