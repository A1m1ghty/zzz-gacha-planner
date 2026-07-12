declare interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

declare interface D1Database {}

declare module "cloudflare:workers" {
  export const env: Record<string, unknown> & { DB?: D1Database };
}
