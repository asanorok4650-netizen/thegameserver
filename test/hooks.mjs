export async function resolve(specifier, context, next) {
  if (specifier === 'three') return { url: new URL('./fake-three.mjs', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
