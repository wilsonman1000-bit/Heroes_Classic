import type { Player } from './player.js';

export class Choice {
    public key: string;
    public description: string;

    constructor(key: string, description: string) {
        this.key = key;
        this.description = description;
    }

    askChoice(player?: Player) {
        console.log(this.key + ') ' + this.description);
    }
}

export async function ask(question: string, choices: Choice[], player?: Player): Promise<Choice> {
    return new Promise(resolve => {
        const askQuestion = () => {
            console.log(question);
            resolve(choices[0] as Choice);
            // Placeholder to avoid unused variable error
            // for (const choice of choices) {
            //     choice.askChoice(player);
            // }
            // rl.question('', answer => {
            //     for (const choice of choices) {
            //         if (answer.trim().toLowerCase() === choice.key.toLowerCase()) {
            //             rl.close();
            //             resolve(choice);
            //             return;
            //         }
            //     }
            //     console.log('Choix invalide. Veuillez entrer une lettre proposée.');
            //     askQuestion();
            // });
        };
        askQuestion();
    });
}
