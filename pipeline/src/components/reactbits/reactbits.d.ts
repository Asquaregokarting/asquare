declare module '*/reactbits/ElectricBorder' {
  import { FC, ReactNode, CSSProperties } from 'react';
  const ElectricBorder: FC<{
    children: ReactNode;
    color?: string;
    speed?: number;
    chaos?: number;
    borderRadius?: number;
    className?: string;
    style?: CSSProperties;
  }>;
  export default ElectricBorder;
}

declare module '*/reactbits/SpotlightCard' {
  import { FC, ReactNode } from 'react';
  const SpotlightCard: FC<{
    children: ReactNode;
    className?: string;
    spotlightColor?: string;
  }>;
  export default SpotlightCard;
}

declare module '*/reactbits/Stepper' {
  import { FC, ReactNode } from 'react';
  const Stepper: FC<{
    children: ReactNode;
    initialStep?: number;
    onStepChange?: (step: number) => void;
    onFinalStepCompleted?: () => void;
    [key: string]: unknown;
  }>;
  export default Stepper;
}
