# OneMoon Frontend

React workspace for the interactive review experience:

- admin login
- project/document list
- document upload
- page overlay viewer
- block inspector for type changes, manual corrections, and regeneration hints
- assembled LaTeX editor and compile-artifact preview

## Commands

```bash
npm install
npm run dev
npm run build
```

## Debug Flag

- `VITE_FRONTEND_DEBUG=true` forces frontend debug UI on.
- `VITE_FRONTEND_DEBUG=false` forces frontend debug UI off.
- If unset, frontend debug UI follows Vite dev mode and is enabled during `npm run dev`.
