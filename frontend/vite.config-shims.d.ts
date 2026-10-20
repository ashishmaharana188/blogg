declare module "node:fs" {
  export interface DirectoryEntry {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string, options: { withFileTypes: true }): DirectoryEntry[];
}

declare module "node:path" {
  export function extname(path: string): string;
  export function relative(from: string, to: string): string;
  export function resolve(...paths: string[]): string;
  export const sep: string;
}
