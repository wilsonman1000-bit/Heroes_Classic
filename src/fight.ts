import type { Player } from "./player.js";

export class Fight {
    // _original => modif constante même après combat
    public player1_original: Player;
    public player2_original: Player;
    // player => modif que sur le fight
    public player1: Player;
    public player2: Player;

    public turn: number;

    constructor(p1: Player, p2: Player) {
        this.player1_original = p1;
        this.player2_original = p2;
        this.player1 = p1.clone();
        this.player2 = p2.clone();
        // Ajuste les maxima des clones pour inclure bonus équipement tout en conservant le pourcentage de PV/Mana actuel
        const p1HpPct = this.player1.pv / this.player1.maxPv;
        const p1ManaPct = this.player1.currentMana / this.player1.maxMana;
        this.player1.maxPv = this.player1.effectiveMaxPv;
        this.player1.pv = Math.round(this.player1.maxPv * p1HpPct);
        this.player1.maxMana = this.player1.effectiveMaxMana;
        this.player1.currentMana = Math.round(this.player1.maxMana * p1ManaPct);

        const p2HpPct = this.player2.pv / this.player2.maxPv;
        const p2ManaPct = this.player2.currentMana / this.player2.maxMana;
        this.player2.maxPv = this.player2.effectiveMaxPv;
        this.player2.pv = Math.round(this.player2.maxPv * p2HpPct);
        this.player2.maxMana = this.player2.effectiveMaxMana;
        this.player2.currentMana = Math.round(this.player2.maxMana * p2ManaPct);

        this.turn = 1;
    }

    async init(): Promise<Player | null> {
        console.log('==========================')
        console.log("COMBAT !!! " + this.player1.name + ' vs ' + this.player2.name);
        console.log('==========================')
        console.log();

        while (this.player1.pv > 0 && this.player2.pv > 0) {
            console.log('Tour n°' + this.turn);

            if (this.turn % 2 == 1) {
                // player1 to play;
                console.log('Tour de ' + this.player1.name);
                const response = await this.player1.playTurn(this.player2);
            } else {
                // player2 to play;
                console.log('Tour de ' + this.player2.name);
                await this.player2.playTurn(this.player1);
            }

            console.log('---')
            this.turn++;
        }
        if (this.player1.pv <= 0 && this.player2.pv <= 0) {
            console.log('Fin du combat : match nul !');
            return null;
        } else if (this.player1.pv <= 0) {
            console.log('Fin du combat : ' + this.player2.name + ' a gagné !');
            return this.player2_original;
        } else {
            console.log('Fin du combat : ' + this.player1.name + ' a gagné !');
            return this.player1_original;
        }
    }
}