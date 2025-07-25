import { isObject } from '@sveltia/utils/object';
import { LocalStorage } from '@sveltia/utils/storage';
import { get, writable } from 'svelte/store';
import { _ } from 'svelte-i18n';
import { goto, parseLocation } from '$lib/services/app/navigation';
import { backend, backendName } from '$lib/services/backends';
import { siteConfig } from '$lib/services/config';
import { dataLoaded } from '$lib/services/contents';
import { user } from '$lib/services/user';
import { prefs } from '$lib/services/user/prefs';

/**
 * @import { Writable } from 'svelte/store';
 * @import { InternalSiteConfig } from '$lib/types/private';
 */

/**
 * @type {Writable<{ message: string, canRetry: boolean }>}
 */
export const signInError = writable({ message: '', canRetry: false });
/**
 * @type {Writable<boolean>}
 */
export const unauthenticated = writable(true);

/**
 * Log an authentication error on the UI and in the browser console.
 * @param {Error} ex Exception.
 */
export const logError = (ex) => {
  let message =
    /** @type {{ message: string }} */ (ex.cause)?.message || get(_)('unexpected_error');

  let canRetry = false;

  if (ex.name === 'NotFoundError') {
    message = get(_)('sign_in_error.not_project_root');
    canRetry = true;
  }

  if (ex.name === 'AbortError') {
    message = get(_)(
      get(backendName) === 'local'
        ? 'sign_in_error.picker_dismissed'
        : 'sign_in_error.authentication_aborted',
    );
    canRetry = true;
  }

  signInError.set({ message, canRetry });
  // eslint-disable-next-line no-console
  console.error(ex.message, ex.cause);
};

/**
 * Check if the user info is cached, set the backend, and automatically start loading files if the
 * backend is Git-based and user’s auth token is found.
 */
export const signInAutomatically = async () => {
  // Find cached user info, including a compatible Netlify/Decap CMS user object
  const userCache =
    (await LocalStorage.get('sveltia-cms.user')) ||
    (await LocalStorage.get('decap-cms-user')) ||
    (await LocalStorage.get('netlify-cms-user'));

  const hasUserCache = isObject(userCache);

  // If the user has been signed out, the user cache is an empty object. In that case, we should not
  // proceed with the sign-in process even if the Decap CMS or Netlify CMS user cache is found. This
  // is to prevent the user from being signed in again automatically immediately after signing out.
  if (hasUserCache && !Object.keys(userCache).length) {
    return;
  }

  let _user = hasUserCache && userCache.backendName ? userCache : undefined;

  // Determine the backend name based on the user cache or site config. Use the local backend if the
  // user cache is found and the backend name is `local`, which is used by Sveltia CMS, or `proxy`,
  // which is used by Netlify/Decap CMS when running the local proxy server. Otherwise, simply use
  // the backend name from the site config. This is to ensure that the user is signed in with the
  // correct backend, especially when the user cache is from a different backend than the current
  // site config.
  const _backendName =
    _user?.backendName === 'local' || _user?.backendName === 'proxy'
      ? 'local'
      : /** @type {InternalSiteConfig} */ (get(siteConfig)).backend.name;

  backendName.set(_backendName);

  const _backend = get(backend);
  const { path } = parseLocation();
  /** @type {Record<string, any> | undefined} */
  let copiedPrefs = undefined;

  // Support QR code authentication
  if (!_user && _backend) {
    const { encodedData } = path.match(/^\/signin\/(?<encodedData>.+)/)?.groups ?? {};

    if (encodedData) {
      goto('', { replaceState: true }); // Remove token from the URL

      try {
        const data = JSON.parse(atob(encodedData));

        if (isObject(data) && typeof data.token === 'string') {
          _user = { token: data.token };

          if (isObject(data.prefs)) {
            copiedPrefs = data.prefs;
          }
        }
      } catch {
        //
      }
    }
  }

  if (_user && _backend) {
    // Temporarily populate the `user` store with the cache, otherwise it’s not updated in
    // `refreshAccessToken`
    user.set(_user);

    const { token, refreshToken } = _user;

    try {
      _user = await _backend.signIn({ token, refreshToken, auto: true });
    } catch {
      // The local backend may throw if the file handle permission is not given
      _user = undefined;
      user.set(undefined);
    }
  }

  unauthenticated.set(!_user);

  if (!_user || !_backend) {
    return;
  }

  // Use the cached user to start fetching files
  user.set(_user);

  // Copy user preferences passed with QR code
  if (copiedPrefs) {
    prefs.update((currentPrefs) => ({ ...currentPrefs, ...copiedPrefs }));
  }

  try {
    await _backend.fetchFiles();
    // Reset error
    signInError.set({ message: '', canRetry: false });
  } catch (/** @type {any} */ ex) {
    // The API request may fail if the cached token has been expired or revoked. Then let the user
    // sign in again. 404 Not Found is also considered an authentication error.
    // https://docs.github.com/en/rest/overview/troubleshooting-the-rest-api#404-not-found-for-an-existing-resource
    if ([401, 403, 404].includes(ex.cause?.status)) {
      unauthenticated.set(true);
    } else {
      logError(ex);
    }
  }
};

/**
 * Sign in with the given backend.
 * @param {string} _backendName Backend name to be used.
 * @param {string} [token] Personal Access Token (PAT) to be used for authentication.
 */
export const signInManually = async (_backendName, token) => {
  backendName.set(_backendName);

  const _backend = get(backend);

  if (!_backend) {
    return;
  }

  let _user;

  try {
    _user = await _backend.signIn({ token, auto: false });
  } catch (/** @type {any} */ ex) {
    unauthenticated.set(true);
    logError(ex);

    return;
  }

  unauthenticated.set(!_user);

  if (!_user) {
    return;
  }

  user.set(_user);

  try {
    await _backend.fetchFiles();
    // Reset error
    signInError.set({ message: '', canRetry: false });
  } catch (/** @type {any} */ ex) {
    logError(ex);
  }
};

/**
 * Sign out from the current backend.
 */
export const signOut = async () => {
  await get(backend)?.signOut();

  // Leave an empty user object in the local storage to prevent the user from being signed in
  // again automatically in `signInAutomatically`.
  await LocalStorage.set('sveltia-cms.user', {});

  backendName.set(undefined);
  user.set(undefined);
  unauthenticated.set(true);
  dataLoaded.set(false);
};
