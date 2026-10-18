import React, { useEffect, useRef, useState } from "react";
import type { Edits } from "./types";
import { freshEdits } from "./types";

type Request = {
  albumId: string;
  photoId: string;
  originalURL: string;
  edits: Edits;
};
// Keep at most one render in flight and one latest request queued while dragging.
export function Preview({
  albumId,
  photoId,
  originalURL,
  alt,
  edits,
  onError,
}: {
  albumId: string;
  photoId: string;
  originalURL: string;
  alt: string;
  edits: Edits;
  onError: (message: string) => void;
}) {
  const [url, setURL] = useState(originalURL);
  const mounted = useRef(true),
    running = useRef(false),
    pending = useRef<Request | null>(null),
    currentPhoto = useRef(photoId);
  currentPhoto.current = photoId;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current = null;
    };
  }, []);
  const serialized = JSON.stringify(edits);
  useEffect(() => {
    pending.current = {
      albumId,
      photoId,
      originalURL,
      edits: JSON.parse(serialized),
    };
    if (running.current) return;
    async function drain() {
      running.current = true;
      try {
        while (mounted.current && pending.current) {
          const request = pending.current;
          pending.current = null;
          try {
            const next =
              JSON.stringify(request.edits) === JSON.stringify(freshEdits())
                ? request.originalURL
                : await window.openshoot.preview(
                    request.albumId,
                    request.photoId,
                    request.edits,
                  );
            if (mounted.current && currentPhoto.current === request.photoId)
              setURL(next);
          } catch (error) {
            if (
              mounted.current &&
              currentPhoto.current === request.photoId &&
              !pending.current
            )
              onError(
                "Could not update the image preview: " +
                  (error instanceof Error ? error.message : String(error)),
              );
          }
        }
      } finally {
        running.current = false;
      }
    }
    void drain();
  }, [albumId, photoId, originalURL, serialized, onError]);
  return <img className="main-preview" src={url} alt={alt} />;
}
