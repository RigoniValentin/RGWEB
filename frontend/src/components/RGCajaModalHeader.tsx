import type { ReactNode } from 'react';
import { RGLogo } from './RGLogo';

type RGCajaModalHeaderProps = {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  tag?: string;
};

export function RGCajaModalHeader({ icon, title, subtitle, tag }: RGCajaModalHeaderProps) {
  return (
    <div className="rg-modal-title">
      <div className="rg-modal-title__icon">{icon}</div>
      <div className="rg-modal-title__text">
        <div className="rg-modal-title__main">{title}</div>
        {subtitle && <div className="rg-modal-title__sub">{subtitle}</div>}
      </div>
      {tag && <div className="rg-modal-title__tag">{tag}</div>}
      <div className="rg-modal-title__brand">
        <RGLogo size={22} showText={false} variant="gold" />
      </div>
    </div>
  );
}
