import { useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';

interface Props {
  onResult: (decodedText: string) => void;
  onClose: () => void;
}

export function BarcodeScanner({ onResult, onClose }: Props) {
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    if (!scannerRef.current) {
      scannerRef.current = new Html5QrcodeScanner(
        'reader',
        { 
          fps: 10, 
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
          formatsToSupport: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] // All formats
        },
        false
      );

      scannerRef.current.render(
        (decodedText) => {
          if (scannerRef.current) {
            scannerRef.current.clear();
          }
          onResult(decodedText);
        },
        (_error) => {
          // ignore error (it triggers continuously when no QR code is found)
        }
      );
    }

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(e => console.warn("Failed to clear scanner", e));
        scannerRef.current = null;
      }
    };
  }, [onResult]);

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
        <h2 style={{ margin: 0, fontSize: '18px' }}>Scan Barcode / QR Code</h2>
        <button onClick={onClose} className="btn">Close</button>
      </div>
      <div style={{ flex: 1, padding: '16px', overflow: 'auto' }}>
        <div id="reader" style={{ width: '100%', maxWidth: '600px', margin: '0 auto', background: '#000' }}></div>
      </div>
    </div>
  );
}
