function restoreAlbum(snapshot, current) {
  const saved = new Set(snapshot.photos.map((p) => p.id));
  const paths = new Set(snapshot.photos.map((p) => p.path));
  return {
    ...snapshot,
    photos: [
      ...snapshot.photos,
      ...current.photos.filter((p) => !saved.has(p.id) && !paths.has(p.path)),
    ],
  };
}
module.exports = { restoreAlbum };
