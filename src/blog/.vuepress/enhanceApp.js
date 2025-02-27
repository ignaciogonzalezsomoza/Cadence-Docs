/**
 * Client app enhancement file.
 *
 * https://v1.vuepress.vuejs.org/guide/basic-config.html#app-level-enhancements
 */

export default ({
  Vue, // the version of Vue being used in the VuePress app
  options, // the options for the root Vue instance
  router, // the router instance for the app
  siteData // site metadata
}) => {
  router.beforeResolve((to, _from, next) => {
    const browserWindow = typeof window !== "undefined" ? window : null;
    if (!browserWindow || to.path.startsWith('/blog')) {
      next();
    } else {
      browserWindow.location.href = to.fullPath;
    }
  });
}
