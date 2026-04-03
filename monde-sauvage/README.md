# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Runtime QA Audits

The project includes Playwright-based runtime audits for the two high-priority regression areas:

- WebGL fallback behavior on map bootstrapping
- Authenticated user smoke flow (login, account settings access, booking step-1 entry)

Run with a local app server already running (default: http://127.0.0.1:5173).

1. WebGL fallback audit:

```bash
npm run audit:no-webgl
```

2. Authenticated smoke audit (requires test credentials):

```bash
AUDIT_AUTH_EMAIL=test@example.com AUDIT_AUTH_PASSWORD=secret npm run audit:auth-smoke
```

3. Combined recommended audits:

```bash
AUDIT_AUTH_EMAIL=test@example.com AUDIT_AUTH_PASSWORD=secret npm run audit:recommended
```

Optional environment variables:

- AUDIT_BASE_URL (default: http://127.0.0.1:5173)
- AUDIT_MAP_ROUTE (default: /map)
- AUDIT_SOCIAL_ROUTE (default: /social)
- STRICT_AUTH_AUDIT=1 to fail when credentials are missing
