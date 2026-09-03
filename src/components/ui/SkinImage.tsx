import React, { useEffect, useState } from 'react';

interface SkinImageProps {
  /** URL de la imagen (puede ser enlace de Google Drive, se normaliza sola). */
  src?: string;
  alt?: string;
  className?: string;
  /** Contenido a mostrar mientras carga o si falla la carga. */
  fallback?: React.ReactNode;
  /** Se invoca si la imagen no pudo cargarse (para que el padre muestre un aviso). */
  onLoadError?: () => void;
}

/**
 * <img> con manejo de errores para las skins.
 * - Normaliza la URL automáticamente (soporta Google Drive, etc.).
 * - Si la imagen falla al cargar, muestra `fallback` en su lugar (sin icono roto).
 * - Si la URL cambia, reinicia el estado de error.
 */
export const SkinImage: React.FC<SkinImageProps> = ({
  src,
  alt = '',
  className,
  fallback = null,
  onLoadError,
}) => {
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    setError(false);
  }, [src]);

  if (!src || error) {
    return <>{fallback}</>;
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => {
        setError(true);
        onLoadError?.();
      }}
    />
  );
};