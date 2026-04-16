// Ambient module shims for client-side dependencies loaded via the browser
// importmap at runtime rather than node_modules. Declaring them here lets
// tsc compile our .ts/.tsx files without pulling @types/* or the full MUI
// package into devDependencies. Swap these for real type packages later if
// we want tighter checking.

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars */

declare module "react" {
  export function useState<T>(init?: T | (() => T)): [T, (v: T | ((p: T) => T)) => void];
  export function useEffect(fn: () => any, deps?: any[]): void;
  export function useMemo<T>(fn: () => T, deps?: any[]): T;
  export function useRef<T>(init?: T): { current: T };
  export function useCallback<T extends (...args: any[]) => any>(fn: T, deps: any[]): T;
  export const createElement: any;
  export const Fragment: any;
  const React: any;
  export default React;

  export type ReactNode = any;
  export type MouseEvent<T = Element> = globalThis.MouseEvent & { currentTarget: T };
  export type ChangeEvent<T = Element> = globalThis.Event & { target: T };
}
declare module "react/jsx-runtime" {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
}
declare module "react-dom" {
  const x: any;
  export default x;
}
declare module "react-dom/client" {
  export const createRoot: any;
}
declare module "@mui/material" {
  const anyExport: any;
  export default anyExport;
  export const Box: any;
  export const Paper: any;
  export const Typography: any;
  export const Container: any;
  export const Button: any;
  export const IconButton: any;
  export const Chip: any;
  export const Tooltip: any;
  export const Alert: any;
  export const CircularProgress: any;
  export const Table: any;
  export const TableHead: any;
  export const TableBody: any;
  export const TableRow: any;
  export const TableCell: any;
  export const TablePagination: any;
  export const Menu: any;
  export const MenuItem: any;
  export const Checkbox: any;
  export const ListItemIcon: any;
  export const ListItemText: any;
  export const Link: any;
  export const Autocomplete: any;
  export const TextField: any;
}
declare module "htm" {
  const x: any;
  export default x;
}

declare namespace React {
  type ReactNode = any;
  type MouseEvent<T = Element> = globalThis.MouseEvent & { currentTarget: T };
  type ChangeEvent<T = Element> = globalThis.Event & { target: T };
}

// JSX plumbing — lets tsc type-check <Component ... /> syntax without the
// real @types/react package. Every element accepts `key`/`ref`, and every
// intrinsic tag accepts any props.
declare namespace JSX {
  interface Element {}
  interface ElementClass {}
  interface ElementAttributesProperty { props: {} }
  interface ElementChildrenAttribute { children: {} }
  interface IntrinsicAttributes { key?: any; ref?: any; children?: any }
  interface IntrinsicClassAttributes<T> { key?: any; ref?: any }
  interface IntrinsicElements { [tagName: string]: any }
}
