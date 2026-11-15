const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  viewBox: '0 0 24 24',
  'aria-hidden': 'true',
  focusable: 'false',
};

const Svg = ({ children, className = 'h-4 w-4', ...rest }) => (
  <svg {...base} className={className} {...rest}>
    {children}
  </svg>
);

export const BoltIcon = (props) => (
  <Svg {...props}>
    <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" />
  </Svg>
);

export const CopyIcon = (props) => (
  <Svg {...props}>
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H6.5A2.5 2.5 0 0 0 4 5.5v6A2.5 2.5 0 0 0 6.5 14" />
  </Svg>
);

export const CheckIcon = (props) => (
  <Svg {...props}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Svg>
);

export const QrIcon = (props) => (
  <Svg {...props}>
    <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.5" />
    <rect x="14" y="3.5" width="6.5" height="6.5" rx="1.5" />
    <rect x="3.5" y="14" width="6.5" height="6.5" rx="1.5" />
    <path d="M14 14h2.5v2.5H14zM18 14h2.5M18 18h2.5v2.5H18zM14 18v2.5" />
  </Svg>
);

export const CloseIcon = (props) => (
  <Svg {...props}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const ArrowUpIcon = (props) => (
  <Svg {...props}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Svg>
);

export const ArrowDownIcon = (props) => (
  <Svg {...props}>
    <path d="M12 5v14M18 13l-6 6-6-6" />
  </Svg>
);

export const ClockIcon = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 1.8" />
  </Svg>
);

export const InfinityIcon = (props) => (
  <Svg {...props}>
    <path d="M6.8 8.2a3.4 3.4 0 0 1 4.8.4L12 9.3l.4-.7a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1-4.8-.4L7.2 14l-.4.7a3.4 3.4 0 1 1 0-6.5Z" />
  </Svg>
);

export const ShieldIcon = (props) => (
  <Svg {...props}>
    <path d="M12 3.2 5 5.8v5.4c0 4 2.8 7.3 7 9.6 4.2-2.3 7-5.6 7-9.6V5.8Z" />
    <path d="m9 12 2 2 4-4.5" />
  </Svg>
);

export const AlertIcon = (props) => (
  <Svg {...props}>
    <path d="M12 3.8 2.9 19.5h18.2Z" />
    <path d="M12 9.5v4.2M12 16.6h.01" />
  </Svg>
);

export const RefreshIcon = (props) => (
  <Svg {...props}>
    <path d="M20 11a8 8 0 1 0-2.4 5.7" />
    <path d="M20 4.5V11h-6.5" />
  </Svg>
);

export const DownloadIcon = (props) => (
  <Svg {...props}>
    <path d="M12 3.5v11M7.5 10 12 14.5 16.5 10" />
    <path d="M4.5 17.5v1a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-1" />
  </Svg>
);

export const SignalIcon = (props) => (
  <Svg {...props}>
    <path d="M4 20v-3M9.3 20v-6M14.7 20v-9.5M20 20V20" />
    <path d="M20 20v-13" strokeWidth="2.4" />
  </Svg>
);

export const LinkIcon = (props) => (
  <Svg {...props}>
    <path d="M10.5 13.5a3.6 3.6 0 0 0 5.1 0l2.6-2.6a3.6 3.6 0 1 0-5.1-5.1L11.6 7.3" />
    <path d="M13.5 10.5a3.6 3.6 0 0 0-5.1 0l-2.6 2.6a3.6 3.6 0 1 0 5.1 5.1l1.5-1.5" />
  </Svg>
);

export const SpinnerIcon = ({ className = 'h-4 w-4' }) => (
  <svg
    className={`animate-spin ${className}`}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2.5" />
    <path
      d="M21 12a9 9 0 0 0-9-9"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
  </svg>
);
