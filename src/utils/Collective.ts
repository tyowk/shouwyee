export class Collective<K, V> extends Map<K, V> {
    constructor() {
        super();
    }

    public create(key: K, value: V) {
        return super.set(key, value);
    }

    public filter(fn: (value: V, index: number, array: V[]) => V[]): V[] {
        return Array.from(this.V).filter(fn);
    }

    public filterKeys(fn: (key: K, index: number, array: K[]) => K[]): any[] {
        return Array.from(this.K).filter(fn);
    }

    public find(fn: (value: V, index: number, array: V[]) => V | undefined): any | undefined {
        return Array.from(this.V).find(fn);
    }

    public some(fn: (value: V, index: number, array: V[]) => boolean): boolean {
        return Array.from(this.V).some(fn);
    }

    public has(key: K): boolean {
        return super.has(key);
    }

    public get K() {
        return [...this.keys()];
    }

    public get V() {
        return [...this.values()];
    }
}
