import { get } from 'svelte/store';
import { siteConfig } from '$lib/services/config';
import { allEntries } from '$lib/services/contents';
import { getAssociatedCollections } from '$lib/services/contents/entry';

/**
 * @import {
 * Entry,
 * FileCollection,
 * InternalCollection,
 * InternalCollectionFile,
 * } from '$lib/types/private';
 */

/**
 * Get a file collection’s file configurations that matches the given entry. One file can
 * theoretically appear in multiple collections files depending on the configuration, so that the
 * result is an array.
 * @param {InternalCollection} collection Collection.
 * @param {Entry} entry Entry.
 * @returns {InternalCollectionFile[]} Collection files.
 */
export const getFilesByEntry = (collection, entry) => {
  const _fileMap = collection.files
    ? /** @type {FileCollection} */ (collection)._fileMap
    : undefined;

  if (!_fileMap) {
    // It’s an entry collection
    return [];
  }

  return Object.values(_fileMap).filter(
    ({ _file, _i18n }) => _file.fullPath === entry.locales[_i18n.defaultLocale]?.path,
  );
};

/**
 * Get a file collection entry that matches the given collection name and file name.
 * @param {string} collectionName Collection name.
 * @param {string} fileName Collection file name.
 * @returns {Entry | undefined} File.
 * @see https://decapcms.org/docs/collection-file/
 */
export const getFile = (collectionName, fileName) =>
  get(allEntries).find((entry) =>
    getAssociatedCollections(entry).some(
      (collection) =>
        collection.name === collectionName &&
        getFilesByEntry(collection, entry).some((file) => file.name === fileName),
    ),
  );

/**
 * Get the index of a collection file with the given name.
 * @param {string | undefined} collectionName Collection name.
 * @param {string | undefined} fileName Collection file name.
 * @returns {number} Index.
 */
export const getFileIndex = (collectionName, fileName) => {
  if (collectionName && fileName) {
    return (
      get(siteConfig)
        ?.collections.find(({ name }) => name === collectionName)
        ?.files?.findIndex(({ name }) => name === fileName) ?? -1
    );
  }

  return -1;
};
