/** A stylesheet's text, inlined by the build (Vite `?raw`). */
declare module '*.css?raw' {
  const css: string
  export default css
}
