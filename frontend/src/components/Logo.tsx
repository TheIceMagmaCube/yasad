/** Draw the YASAD logo (assets/logo/) in the current text color. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 2048 2048" className={className} aria-hidden="true" focusable="false">
      <g fill="currentColor">
        <rect x="1192.98" y="648.129" width="1600.75" height="258.985" transform="matrix(0.543961,-0.723836,0.801953,0.602665,-964.53,1888.44)" />
        <rect x="1192.98" y="648.129" width="1600.75" height="258.985" transform="matrix(0.455713,-0.606407,0.799425,0.600766,-569.738,2017.05)" />
        <rect x="1192.98" y="648.129" width="1600.75" height="258.985" transform="matrix(-0.297033,-0.224726,0.942126,-1.24526,582.048,2079.94)" />
        <rect x="1192.98" y="648.129" width="1600.75" height="258.985" transform="matrix(-0.184005,-0.988128,0.9831,-0.183069,951.793,3136.05)" />
      </g>
      <path
        d="M3248.49,-71.479C3600.42,-83.166 3545.39,-77.009 3622.77,506.887C3687.52,995.432 3691.41,995.735 3327.85,1002.3"
        transform="matrix(0.809727,-0.109978,0.192284,1.41572,-1284.42,704.814)"
        fill="none"
        stroke="currentColor"
        strokeWidth="63.16"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
