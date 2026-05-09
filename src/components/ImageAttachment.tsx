import { X } from 'lucide-react';

interface Props {
  dataUrl:  string;
  onRemove: () => void;
}

export function ImageAttachment({ dataUrl, onRemove }: Props) {
  return (
    <div className="image-attachment">
      <img src={dataUrl} alt="attachment" className="image-attachment__thumb" />
      <button
        className="image-attachment__remove"
        onClick={onRemove}
        title="Remove image"
        type="button"
      >
        <X size={10} />
        <span className="sr-only">Remove</span>
      </button>
    </div>
  );
}
