import { ask, type Choice } from "./choice.js";

export class Home {

    public choices: Choice[];

    constructor(choices: Choice[]) {
        this.choices = choices;
    }

    public async init() {
        console.log('==========================')
        console.log('Menu principal :');
        console.log('==========================')
        console.log();
        const response = await ask('Que voulez-vous faire ?', this.choices);
        return response;
    }
}