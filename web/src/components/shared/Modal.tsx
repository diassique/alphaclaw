import type { ReactNode, MouseEvent } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Modal({ open, onClose, title, children }: Props) {
  if (!open) return null;

  const handleOverlay = (e: MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="modal-overlay open" onClick={handleOverlay}>
      <div className="modal">
        <button className="modal-close" onClick={onClose}>
          Close
        </button>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
