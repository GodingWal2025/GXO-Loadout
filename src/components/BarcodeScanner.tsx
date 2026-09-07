import { useLayoutEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { useT } from '../shared/i18n/LanguageContext';

interface Props {
  onResult: (decodedText: string) => void;
  onClose: () => void;
}

export function BarcodeScanner({ onResult, onClose }: Props) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    scannerRef.current = new Html5Qrcode('barcode-photo-reader', {
      formatsToSupport: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      verbose: false,
    });

    // Immediately hand off to the device's native rear-camera capture UI.
    // The visible button below remains available after cancel or a bad photo.
    inputRef.current?.click();

    return () => {
      scannerRef.current?.clear();
      scannerRef.current = null;
    };
  }, []);

  const capturePhoto = () => {
    setError(null);
    inputRef.current?.click();
  };

  const handlePhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Let the user select the same photo again after an unsuccessful read.
    event.target.value = '';
    if (!file || !scannerRef.current) return;

    setIsReading(true);
    setError(null);
    try {
      const decodedText = await scannerRef.current.scanFile(file, true);
      scannerRef.current.clear();
      onResult(decodedText);
    } catch {
      setError(
        t(
          'scanner.notFound',
          'No barcode was found in that picture. Move closer, keep the barcode in focus, and try again.'
        )
      );
    } finally {
      setIsReading(false);
    }
  };

  return (
    <div style={{ 
      position: 'fixed', 
      top: 0, 
      left: 0, 
      right: 0, 
      bottom: 0, 
      backgroundColor: 'var(--paper)', 
      zIndex: 9999, 
      display: 'flex', 
      flexDirection: 'column' 
    }}>
      <div style={{ 
        padding: '16px', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        background: 'var(--surface)', 
        borderBottom: '1px solid var(--rule-soft)' 
      }}>
        <h2 style={{ margin: 0, fontSize: '18px' }}>
          {t('scanner.title', 'Scan Barcode / QR Code')}
        </h2>
        <button onClick={onClose} className="btn">{t('scanner.close', 'Close')}</button>
      </div>
      <div style={{ flex: 1, padding: '24px 16px', overflow: 'auto', textAlign: 'center' }}>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handlePhoto}
          style={{ display: 'none' }}
          aria-hidden="true"
          tabIndex={-1}
        />

        <p style={{ margin: '0 auto 16px', maxWidth: '520px' }}>
          {t(
            'scanner.photoHint',
            'Take a clear picture with the full barcode inside the frame.'
          )}
        </p>

        <div
          id="barcode-photo-reader"
          style={{ width: '100%', maxWidth: '600px', margin: '0 auto 16px', background: '#000' }}
        />

        {error && (
          <div className="alert alert--danger" role="alert" style={{ maxWidth: '600px', margin: '0 auto 16px' }}>
            {error}
          </div>
        )}

        <button
          type="button"
          className="btn btn--accent"
          onClick={capturePhoto}
          disabled={isReading}
        >
          {isReading
            ? t('scanner.reading', 'Reading barcode…')
            : t('scanner.takePicture', '📷 Take barcode picture')}
        </button>
      </div>
    </div>
  );
}
