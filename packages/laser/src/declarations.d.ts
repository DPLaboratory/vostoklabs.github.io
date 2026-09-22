// Vite asset imports used by the photo worker (the ONNX runtime's wasm + loader, the model).
// The apps get these from `vite/client`; the package typechecks on its own, so it declares them.
declare module '*?url' {
  const url: string;
  export default url;
}
