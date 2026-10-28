// next/cache, outside a Next request: nothing is cached, so nothing to revalidate.
module.exports = {
  revalidatePath() {},
  revalidateTag() {},
  unstable_cache: (fn) => fn,
};
