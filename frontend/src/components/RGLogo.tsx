/**
 * Río Gestión Logo — Image Component
 * Uses actual brand logo assets with 3 variants:
 *   - white:  white bg, gold "r", black "g"  (default / main)
 *   - dark:   black circle bg, gold "r", white "g"
 *   - gold:   gold circle bg, white "r", black "g"
 */
import LogoBlanco from '../assets/logos/LogoFondoBlanco.png';
import LogoNegro from '../assets/logos/LogoFondoNegro.png';
import LogoAmarillo from '../assets/logos/LogoFondoAmarillo.png';

const logoMap = {
  white: LogoBlanco,
  dark: LogoNegro,
  gold: LogoAmarillo,
} as const;

type LogoVariant = keyof typeof logoMap;

interface RGLogoProps {
  size?: number;
  collapsed?: boolean;
  showText?: boolean;
  variant?: LogoVariant;
}

export function RGLogo({
  size = 48,
  collapsed = false,
  showText = true,
  variant = 'white',
}: RGLogoProps) {
  const textColor =
    variant === 'dark' ? '#FFFFFF' :
    variant === 'gold' ? '#1E1F23' :
    '#1E1F23'; // white variant → dark text (or override externally)

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: collapsed ? 0 : 12,
      transition: 'all 0.3s ease',
    }}>
      {/* Logo Image */}
      <img
        src={logoMap[variant]}
        alt="Río Gestión"
        width={size}
        height={size}
        style={{
          flexShrink: 0,
          objectFit: 'contain',
          borderRadius: variant === 'white' ? 8 : '50%',
          transition: 'all 0.3s ease',
        }}
        draggable={false}
      />

      {/* Text */}
      {showText && !collapsed && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          lineHeight: 1.1,
          whiteSpace: 'nowrap',
          opacity: collapsed ? 0 : 1,
          transition: 'opacity 0.3s ease',
        }}>
          <span style={{
            fontSize: size * 0.33,
            fontWeight: 300,
            color: textColor,
            letterSpacing: '0.02em',
            fontStyle: 'italic',
          }}>
            río
          </span>
          <span style={{
            fontSize: size * 0.36,
            fontWeight: 700,
            color: textColor,
            letterSpacing: '0.04em',
          }}>
            gestión
          </span>
        </div>
      )}
    </div>
  );
}
