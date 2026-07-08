# paulgraham-cn.com

Chinese translations of Paul Graham's essays.

## Translate (local, needs Vertex credentials)

```bash
export GOOGLE_APPLICATION_CREDENTIALS=credentials/gemini-vertex.json
npm run translate            # all essays (incremental, segment-level)
npm run translate -- --only=earn,greatwork   # subset
npm run translate -- --limit=10              # first N
```

Outputs `content/articles/*.json` + `content/manifest.json`. Commit these.

## Site

```bash
npm run dev       # local dev
npm run build     # -> dist/, no API calls
```

## Deploy (Cloudflare Pages)

- Build command: `npm run build`
- Output directory: `dist`
- No environment variables or secrets needed (translation is pre-baked into committed JSON).
- Bind custom domain `paulgraham-cn.com`.
