import readline from 'node:readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});
function ask(question: string) {
    return new Promise(resolve => {
        rl.question(question, answer => {
            resolve(answer);
        });
    });
}

class Hero {
    public pv: number;
    public attack: number;

    constructor(pv: number, attack: number) {
        this.pv = pv;
        this.attack = attack;
    }
}

const gentil = new Hero(50, 50);
const mechant = new Hero(50, 8);

let turn: 'gentil' | 'mechant' = 'gentil';
let gagnant: 'gentil' | 'mechant' | undefined;
while (gentil.pv > 0 && mechant.pv > 0) {
    console.log('Tour du ' + turn);
    const response = await ask('Attacker (A) ou Passer (P)');
    if (turn === 'gentil') {
        if (response === 'A') {
            mechant.pv -= gentil.attack;
            console.log('Le méchant a maintenant ' + mechant.pv + 'pv');
        }
        if (mechant.pv <= 0) {
            gagnant = 'gentil';
        } else {
            turn = 'mechant';
        }
    } else {
        if (response === 'A') {
            gentil.pv -= mechant.attack;
            console.log('Le gentil a maintenant ' + gentil.pv + 'pv');
        }
        if (gentil.pv <= 0) {
            gagnant = 'mechant';
        } else {
            turn = 'gentil';
        }
    }    
}
console.log('Le gagnant est ' + gagnant);