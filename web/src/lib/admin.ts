// Admin mode: enabled in dev via VITE_ADMIN=true in .env.development.
// Tree-shaken out of production builds (VITE_ADMIN is undefined → false).
export const IS_ADMIN = !!import.meta.env.VITE_ADMIN;
