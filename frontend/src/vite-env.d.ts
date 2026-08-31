/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

export {}

// `webkitdirectory` is how every browser exposes directory selection on a file
// input — it is on `HTMLInputElement` in lib.dom, but @types/react does not
// list it as a JSX attribute. React 19 passes an unknown lowercase attribute
// straight through to the DOM, so declaring it here is the whole fix.
//
// The `export {}` above is load-bearing: it makes this file a module, which is
// what turns the block below into an augmentation of React's types rather than
// an ambient redeclaration that would shadow them entirely.
declare module 'react' {
  // `T` goes unused here but cannot be renamed or dropped: merging an interface
  // requires type parameters identical to the declaration being merged into.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string | undefined
  }
}
