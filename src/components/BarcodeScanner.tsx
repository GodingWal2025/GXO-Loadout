import { useEffect, useId, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { useT } from '../shared/i18n/LanguageContext';

interface Props {
  onResult: (decodedText: string) => void;
}

/**
 * Photo-based barcode reader. Mobile devices open the rear camera for one tag
 * picture; desktop browsers fall back to a normal image picker. No live camera
 * stream is kept open.
 */
export function BarcodeScanner({ onResult }: Props) {
  const t = useT();
  const readerId = `barcode-photo-reader-${useId().replace(/:/g, '')}`;
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    scannerRef.current?.clear();
    scannerRef.current = null;
  }, []);

  const handlePhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Let the user select the same photo again after an unsuccessful read.
    event.target.value = '';
    if (!file) return;

    setIsReading(true);
    setError(null);
    try {
      const scanner = scannerRef.current ?? new Html5Qrcode(readerId, {
        formatsToSupport: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        verbose: false,
      });
      scannerRef.current = scanner;
      const decodedText = await scanner.scanFile(file, true);
      scanner.clear();
      onResult(decodedText);
    } catch {
      setError(
        t(
          'scanner.notFound',
          'No barcode was found in that picture. Move closer, keep the tag in focus, and try again.'
        )
      );
    } finally {
      setIsReading(false);
    }
  };

  const pictureLabel = t('suggest.scanBarcode', 'Take a picture of the tag');

  return (
    <>
      <label
        className="btn btn--outline"
        style={{ padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        title={pictureLabel}
        aria-label={pictureLabel}
        aria-disabled={isReading}
      >
        {isReading ? '…' : '📷'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handlePhoto}
          disabled={isReading}
          style={{ display: 'none' }}
        />
      </label>
      {/* html5-qrcode requires a mounted container even when decoding a file.
          Keep it off-screen; the selected tag photo is the only operator UI. */}
      <div
        id={readerId}
        aria-hidden="true"
        style={{ position: 'fixed', left: -10000, width: 320, height: 240, overflow: 'hidden' }}
      />
      {error && (
        <div className="alert alert--danger" role="alert" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
    </>
  );
}
