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
  
  // Определяем, является ли медиа видео или изображением
  const isVideo = media.file_type === 'video';
  
  // Используем хук для эффекта свечения (работает и для видео, и для изображений)
  // Используем соответствующий ref в зависимости от типа медиа
  const videoGlow = useVideoGlow(videoRef);
  const imageGlow = useVideoGlow(imageRef);
  const glowColor = isVideo ? videoGlow : imageGlow;

  // Загружаем URL медиа файла и сбрасываем предыдущее видео
  useEffect(() => {
    let isMounted = true;
    
    // Останавливаем и сбрасываем предыдущее видео при смене медиа
    if (videoRef.current) {
      const video = videoRef.current;
      video.pause();
      video.currentTime = 0;
      video.src = '';
      video.load(); // Сбрасываем состояние видео
    }
    
    // Сбрасываем URL при смене медиа для предотвращения использования старого кеша
    setMediaUrl(null);

    const loadMediaUrl = async () => {
      try {
        if (!isMounted) return;
        setIsLoading(true);
        setError(null);
        
        // Формируем URL с timestamp для предотвращения кеширования
        const baseUrl = await fetchMediaFile(media.id);
        // Используем uploaded_at из медиа или текущее время для уникальности URL
        const timestamp = media.uploaded_at 
          ? new Date(media.uploaded_at).getTime() 
          : Date.now();
        const url = `${baseUrl}?t=${timestamp}&v=${media.id}`;
        
        if (isMounted) {
          setMediaUrl(url);
        }
      } catch (err) {
        if (!isMounted) return;
        console.error('Ошибка формирования URL медиа:', err);
        setError('Не удалось загрузить медиа');
        // При ошибке загрузки переключаемся на следующее
        setTimeout(() => {
          if (isMounted) {
            console.warn('Автоматическое переключение на следующее медиа из-за ошибки загрузки');
            onNext();
          }
        }, 2000);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadMediaUrl();
    
    return () => {
      isMounted = false;
    };
  }, [media.id, media.uploaded_at, onNext]);

  // Автозапуск видео после загрузки
  useEffect(() => {
    if (!isVideo || !videoRef.current || !mediaUrl) return;

    const video = videoRef.current;
    let isMounted = true;

    const handleCanPlay = async () => {
      if (!isMounted || video.paused === false) return;
      
      try {
        // Сбрасываем текущее время на случай, если видео было перезагружено
        video.currentTime = 0;
        const playPromise = video.play();
        
        if (playPromise !== undefined) {
          await playPromise;
        }
      } catch (err) {
        // Игнорируем ошибки автозапуска (браузер может блокировать)
        console.warn('Автозапуск видео заблокирован браузером:', err);
      }
    };

    const handleLoadedData = () => {
      if (!isMounted) return;
      handleCanPlay();
    };

    // Пытаемся запустить, когда видео готово к воспроизведению
    if (video.readyState >= 3) {
      // HAVE_FUTURE_DATA - достаточно данных для начала воспроизведения
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

  // Обработка окончания видео - переключение на следующее
  useEffect(() => {
    if (isVideo && videoRef.current) {
      const video = videoRef.current;
      const handleEnded = () => {
        onNext();
      };
      
      video.addEventListener('ended', handleEnded);
      return () => {
        video.removeEventListener('ended', handleEnded);
      };
    }
  }, [isVideo, onNext]);

  // Для изображений: автоматическое переключение через 10 секунд
  useEffect(() => {
    if (!isVideo && mediaUrl && !isLoading) {
      const timer = setTimeout(() => {
        onNext();
      }, 10000); // 10 секунд для изображений

      return () => clearTimeout(timer);
    }
  }, [isVideo, mediaUrl, isLoading, onNext]);

  if (isLoading) {
    return (
      <div className="w-full">
        <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden flex items-center justify-center">
          <div className="text-zinc-400">Загрузка...</div>
        </div>
      </div>
    );
  }

  if (error || !mediaUrl) {
    return (
      <div className="w-full">
        <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden flex items-center justify-center">
          <div className="text-zinc-400">{error || 'Медиа не найдено'}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div 
        className="relative w-full aspect-video bg-black rounded-lg overflow-hidden transition-all duration-300"
      >
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
              
              // Детальная диагностика ошибки
              if (error) {
                switch (error.code) {
                  case error.MEDIA_ERR_ABORTED:
                    errorMessage = 'Воспроизведение было прервано';
                    break;
                  case error.MEDIA_ERR_NETWORK:
                    errorMessage = 'Ошибка сети при загрузке видео. Файл может быть удален';
                    shouldAutoNext = true;
                    break;
                  case error.MEDIA_ERR_DECODE:
                    errorMessage = 'Ошибка декодирования видео. Возможно, файл поврежден или формат не поддерживается';
                    shouldAutoNext = true;
                    break;
                  case error.MEDIA_ERR_SRC_NOT_SUPPORTED:
                    errorMessage = 'Формат видео не поддерживается браузером';
                    shouldAutoNext = true;
                    break;
                  default:
                    errorMessage = `Ошибка воспроизведения (код: ${error.code})`;
                    shouldAutoNext = true;
                }
                
                // Логируем дополнительную информацию для отладки
                console.error('Детали ошибки видео:', {
                  code: error.code,
                  message: errorMessage,
                  mediaId: media.id,
                  mediaName: media.name,
                  fileType: media.file_type,
                  videoSrc: videoElement.src,
                  networkState: videoElement.networkState,
                  readyState: videoElement.readyState,
                });
              } else {
                // Если нет деталей ошибки, но networkState указывает на проблему
                if (videoElement.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
                  errorMessage = 'Файл не найден на сервере';
                  shouldAutoNext = true;
                }
                
                console.error('Ошибка видео без деталей:', {
                  mediaId: media.id,
                  mediaName: media.name,
                  videoSrc: videoElement.src,
                  networkState: videoElement.networkState,
                  readyState: videoElement.readyState,
                });
              }
              
              setError(errorMessage);
              
              // Автоматическое переключение на следующее медиа при критических ошибках
              if (shouldAutoNext) {
                setTimeout(() => {
                  console.warn('Автоматическое переключение на следующее медиа из-за ошибки:', errorMessage);
                  onNext();
                }, 2000);
              }
            }}
            onLoadStart={() => {
              // Сбрасываем ошибку при начале новой загрузки
              setError(null);
            }}
            onLoadedMetadata={() => {
              // Логируем успешную загрузку метаданных для отладки
              if (videoRef.current) {
                console.log('Метаданные видео загружены:', {
                  mediaId: media.id,
                  duration: videoRef.current.duration,
                  videoWidth: videoRef.current.videoWidth,
                  videoHeight: videoRef.current.videoHeight,
                  readyState: videoRef.current.readyState,
                });
              }
            }}
            onStalled={() => {
              console.warn('Видео остановилось при загрузке:', media.id);
            }}
            onSuspend={() => {
              console.warn('Загрузка видео приостановлена:', media.id);
            }}
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
                mediaName: media.name,
                imageSrc: e.currentTarget.src,
              });
              setError('Ошибка загрузки изображения. Файл может быть удален');
              // Автоматическое переключение на следующее медиа
              setTimeout(() => {
                console.warn('Автоматическое переключение на следующее медиа из-за ошибки загрузки изображения');
                onNext();
              }, 2000);
            }}
          />
        )}
      </div>
    </div>
  );
}

