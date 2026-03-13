'use client';

import { useEffect, useRef, useState } from 'react';
import { useVideoGlow } from '@/hooks/use-video-glow';
import { fetchMediaFile, Media } from '@/lib/api';

interface MediaPlayerProps {
  media: Media;
  onNext: () => void;
}

export function MediaPlayer({ media, onNext }: MediaPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isVideo = media.file_type === 'video';

  const videoGlow = useVideoGlow(videoRef);
  const imageGlow = useVideoGlow(imageRef);
  const glowColor = isVideo ? videoGlow : imageGlow;

  useEffect(() => {
    let isMounted = true;

    if (videoRef.current) {
      const video = videoRef.current;
      video.pause();
      video.currentTime = 0;
      video.src = '';
      video.load();
    }

    setMediaUrl(null);

    const loadMediaUrl = async () => {
      try {
        if (!isMounted) return;
        setIsLoading(true);
        setError(null);

        const baseUrl = await fetchMediaFile(media.id);
        const timestamp = media.uploaded_at
          ? new Date(media.uploaded_at).getTime()
          : Date.now();
        const url = `${baseUrl}?t=${timestamp}&v=${media.id}`;

        if (isMounted) setMediaUrl(url);
      } catch (err) {
        if (!isMounted) return;
        console.error('Ошибка формирования URL медиа:', err);
        setError('Не удалось загрузить медиа');
        setTimeout(() => {
          if (isMounted) onNext();
        }, 2000);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadMediaUrl();
    return () => { isMounted = false; };
  }, [media.id, media.uploaded_at, onNext]);

  useEffect(() => {
    if (!isVideo || !videoRef.current || !mediaUrl) return;

    const video = videoRef.current;
    let isMounted = true;

    const handleCanPlay = async () => {
      if (!isMounted || video.paused === false) return;
      try {
        video.currentTime = 0;
        const playPromise = video.play();
        if (playPromise !== undefined) await playPromise;
      } catch (err) {
        console.warn('Автозапуск видео заблокирован браузером:', err);
      }
    };

    const handleLoadedData = () => {
      if (isMounted) handleCanPlay();
    };

    if (video.readyState >= 3) {
      handleCanPlay();
    } else {
      video.addEventListener('canplay', handleCanPlay, { once: true });
      video.addEventListener('loadeddata', handleLoadedData, { once: true });
    }

    return () => {
      isMounted = false;
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('loadeddata', handleLoadedData);
    };
  }, [isVideo, mediaUrl]);

  useEffect(() => {
    if (isVideo && videoRef.current) {
      const video = videoRef.current;
      const handleEnded = () => onNext();
      video.addEventListener('ended', handleEnded);
      return () => video.removeEventListener('ended', handleEnded);
    }
  }, [isVideo, onNext]);

  useEffect(() => {
    if (!isVideo && mediaUrl && !isLoading) {
      const timer = setTimeout(() => onNext(), 10000);
      return () => clearTimeout(timer);
    }
  }, [isVideo, mediaUrl, isLoading, onNext]);

  // Все состояния используют absolute inset-0 — размер определяется родителем в page.tsx
  if (isLoading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-zinc-400">Загрузка...</div>
      </div>
    );
  }

  if (error || !mediaUrl) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-zinc-400">{error || 'Медиа не найдено'}</div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      {isVideo ? (
        <video
          key={`${media.id}-${media.uploaded_at || Date.now()}`}
          ref={videoRef}
          src={mediaUrl}
          className="w-full h-full object-contain"
          muted
          loop={false}
          playsInline
          preload="auto"
          crossOrigin="anonymous"
          onError={(e) => {
            const videoElement = e.currentTarget;
            const error = videoElement.error;
            let errorMessage = 'Ошибка воспроизведения видео';
            let shouldAutoNext = false;

            if (error) {
              switch (error.code) {
                case error.MEDIA_ERR_ABORTED:
                  errorMessage = 'Воспроизведение было прервано';
                  break;
                case error.MEDIA_ERR_NETWORK:
                  errorMessage = 'Ошибка сети при загрузке видео';
                  shouldAutoNext = true;
                  break;
                case error.MEDIA_ERR_DECODE:
                  errorMessage = 'Ошибка декодирования видео';
                  shouldAutoNext = true;
                  break;
                case error.MEDIA_ERR_SRC_NOT_SUPPORTED:
                  errorMessage = 'Формат видео не поддерживается';
                  shouldAutoNext = true;
                  break;
                default:
                  errorMessage = `Ошибка воспроизведения (код: ${error.code})`;
                  shouldAutoNext = true;
              }
              console.error('Детали ошибки видео:', {
                code: error.code,
                message: errorMessage,
                mediaId: media.id,
                networkState: videoElement.networkState,
                readyState: videoElement.readyState,
              });
            } else {
              if (videoElement.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
                errorMessage = 'Файл не найден на сервере';
                shouldAutoNext = true;
              }
              console.error('Ошибка видео без деталей:', { mediaId: media.id });
            }

            setError(errorMessage);
            if (shouldAutoNext) {
              setTimeout(() => {
                console.warn('Автопереключение из-за ошибки:', errorMessage);
                onNext();
              }, 2000);
            }
          }}
          onLoadStart={() => setError(null)}
          onLoadedMetadata={() => {
            if (videoRef.current) {
              console.log('Метаданные видео загружены:', {
                mediaId: media.id,
                duration: videoRef.current.duration,
                videoWidth: videoRef.current.videoWidth,
                videoHeight: videoRef.current.videoHeight,
              });
            }
          }}
          onStalled={() => console.warn('Видео остановилось при загрузке:', media.id)}
          onSuspend={() => console.warn('Загрузка видео приостановлена:', media.id)}
        >
          Ваш браузер не поддерживает видео.
        </video>
      ) : (
        <img
          key={`${media.id}-${media.uploaded_at || Date.now()}`}
          ref={imageRef}
          src={mediaUrl}
          alt={media.name}
          className="w-full h-full object-contain"
          onError={(e) => {
            console.error('Ошибка загрузки изображения:', {
              mediaId: media.id,
              imageSrc: e.currentTarget.src,
            });
            setError('Ошибка загрузки изображения');
            setTimeout(() => {
              console.warn('Автопереключение из-за ошибки изображения');
              onNext();
            }, 2000);
          }}
        />
      )}
    </div>
  );
}