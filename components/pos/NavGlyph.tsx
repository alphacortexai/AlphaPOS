export default function NavGlyph({ name }: { name: string }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-glyph">
      {name === 'register' && <><rect x="4" y="5" width="16" height="12" rx="2" {...common} /><path d="M8 19h8M9 9h6M9 13h3" {...common} /></>}
      {name === 'setup' && <path d="M12 3l1.6 3.4L17 8l-3.4 1.6L12 13l-1.6-3.4L7 8l3.4-1.6L12 3zM18 14l.8 1.7L20.5 16.5 18.8 17.3 18 19l-.8-1.7L15.5 16.5l1.7-.8L18 14z" {...common} />}
      {name === 'today' && <><rect x="4" y="5" width="16" height="15" rx="2" {...common} /><path d="M8 3v4M16 3v4M4 10h16" {...common} /></>}
      {name === 'sales' && <path d="M7 4h10l1 3H6l1-3zM6 7h12v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7zM9 11h6M9 15h4" {...common} />}
      {name === 'customers' && <><circle cx="9" cy="9" r="2.5" {...common} /><circle cx="16" cy="10" r="2" {...common} /><path d="M4.5 18c.6-2.4 2.4-3.5 4.5-3.5s3.9 1.1 4.5 3.5M14 14.6c1.2-.4 2.4-.2 3.4.6 1 .8 1.5 1.8 1.6 2.8" {...common} /></>}
      {name === 'products' && <path d="M4 8l8-4 8 4-8 4-8-4zM4 8v8l8 4 8-4V8M12 12v8" {...common} />}
      {name === 'categories' && <><rect x="4" y="4" width="7" height="7" rx="1.5" {...common} /><rect x="13" y="4" width="7" height="7" rx="1.5" {...common} /><rect x="4" y="13" width="7" height="7" rx="1.5" {...common} /><rect x="13" y="13" width="7" height="7" rx="1.5" {...common} /></>}
      {name === 'services' && <path d="M12 3.5l1.8 4.2L18.2 9l-4.4 1.3L12 14.5l-1.8-4.2L5.8 9l4.4-1.3L12 3.5zM6 16.5h12" {...common} />}
      {name === 'expenses' && <><circle cx="12" cy="12" r="8" {...common} /><path d="M8 12h8" {...common} /></>}
      {name === 'reports' && <path d="M5 19V10M10 19V5M15 19v-7M20 19V8" {...common} />}
      {name === 'accounts' && <><rect x="3.5" y="6" width="17" height="12" rx="2" {...common} /><path d="M3.5 10h17M7 15h4" {...common} /></>}
      {name === 'staff' && <><circle cx="12" cy="8" r="3" {...common} /><path d="M6 19c.8-2.8 2.8-4 6-4s5.2 1.2 6 4" {...common} /></>}
      {name === 'activity' && <path d="M5 6h14M5 12h14M5 18h9" {...common} />}
      {name === 'settings' && <><circle cx="12" cy="12" r="3" {...common} /><path d="M12 3.5v2.2M12 18.3V20.5M4.8 6.8l1.6 1.6M17.6 15.6l1.6 1.6M3.5 12h2.2M18.3 12h2.2M4.8 17.2l1.6-1.6M17.6 8.4l1.6-1.6" {...common} /></>}
    </svg>
  );
}
