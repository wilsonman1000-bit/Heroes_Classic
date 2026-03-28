export class AudioManager {
    private sounds: Map<string, HTMLAudioElement> = new Map();

    public loadSound(name: string, path: string, loop: boolean = false, volume: number = 1): void {
        const audio = new Audio();
        audio.src = path;
        audio.loop = loop;
        audio.volume = volume;
        audio.addEventListener('error', (e) => {
            console.error(`Erreur audio ${name}:`, e, `Chemin: ${path}`);
        });
        audio.addEventListener('canplay', () => {
            console.log(`Audio ${name} chargé avec succès`);
        });
        this.sounds.set(name, audio);
    }

    public play(name: string): void {
        const audio = this.sounds.get(name);
        if (audio) {
            audio.currentTime = 0;
            audio.play().catch(err => {
                console.error(`Erreur lors de la lecture de ${name}:`, err);
            });
            console.log(`Musique ${name} lancée`);
        } else {
            console.error(`Son ${name} non trouvé`);
        }
    }

    public isPlaying(name: string): boolean {
        const audio = this.sounds.get(name);
        if (!audio) return false;
        return !audio.paused && !audio.ended;
    }

    public pauseAll(exceptName?: string): string[] {
        const pausedNames: string[] = [];
        for (const [name, audio] of this.sounds.entries()) {
            if (exceptName && name === exceptName) continue;
            // Only pause if currently playing
            if (!audio.paused && !audio.ended) {
                audio.pause();
                pausedNames.push(name);
            }
        }
        return pausedNames;
    }

    // Met en pause uniquement les sons en boucle (musiques d'ambiance),
    // sans couper les SFX courts en cours.
    public pauseAllLooping(exceptName?: string): string[] {
        const pausedNames: string[] = [];
        for (const [name, audio] of this.sounds.entries()) {
            if (exceptName && name === exceptName) continue;
            if (!audio.loop) continue;
            if (!audio.paused && !audio.ended) {
                audio.pause();
                pausedNames.push(name);
            }
        }
        return pausedNames;
    }

    // Pause a specific audio by name (no-op if not found)
    public pause(name: string): void {
        const audio = this.sounds.get(name);
        if (!audio) return;
        if (!audio.paused && !audio.ended) audio.pause();
    }

    public resume(name: string): void {
        const audio = this.sounds.get(name);
        if (!audio) {
            console.error(`Son ${name} non trouvé`);
            return;
        }
        // resume without resetting currentTime
        audio.play().catch(err => {
            console.error(`Erreur lors de la reprise de ${name}:`, err);
        });
    }

    public resumeMany(names: string[]): void {
        for (const name of names) this.resume(name);
    }

    // Joue un son une fois, puis appelle la callback (utile pour une intro qui enchaine)
    public playOnce(name: string, onEnded?: () => void): void {
        const audio = this.sounds.get(name);
        if (!audio) {
            console.error(`Son ${name} non trouvé`);
            return;
        }
        audio.loop = false;
        audio.currentTime = 0;
        const handleEnded = () => {
            audio.removeEventListener('ended', handleEnded);
            if (onEnded) onEnded();
        };
        audio.addEventListener('ended', handleEnded);
        audio.play().catch(err => {
            console.error(`Erreur lors de la lecture de ${name}:`, err);
        });
        console.log(`Lecture en une fois de ${name}`);
    }

    // Joue un son une fois en mode "exclusif": met en pause tous les autres sons,
    // puis les reprend automatiquement quand le son se termine.
    public playOnceExclusive(name: string): void {
        const pausedNames = this.pauseAll(name);
        this.playOnce(name, () => {
            this.resumeMany(pausedNames);
        });
    }
}
