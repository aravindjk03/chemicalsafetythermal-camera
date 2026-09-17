'use strict';

/* =====================================================================
   APP SHELL: hash router + boot
   Screens: #monitor · #analytics · #hazard · #ventilation · #roadmap
   ===================================================================== */

class Router {
  constructor(handlers) {
    this.handlers = handlers;   // { route: { show(params), hide() } }
    this.current = null;
    this.pendingParams = null;
    window.addEventListener('hashchange', () => this.resolve());
  }

  // Navigate to a screen, optionally handing it parameters (e.g. an incident id)
  go(route, params = null) {
    this.pendingParams = params;
    if (location.hash === `#${route}`) {
      this.resolve();
    } else {
      location.hash = route;
    }
  }

  resolve() {
    const route = (location.hash || '#monitor').slice(1);
    const target = this.handlers[route] ? route : 'monitor';
    const params = this.pendingParams;
    this.pendingParams = null;

    document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== `view-${target}`; });
    document.querySelectorAll('.nav-link').forEach(a => {
      const active = a.dataset.route === target;
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });

    if (this.current && this.current !== target && this.handlers[this.current].hide) {
      this.handlers[this.current].hide();
    }
    if (this.current !== target) window.scrollTo(0, 0);
    this.current = target;
    if (this.handlers[target].show) this.handlers[target].show(params);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const telemetry = new TelemetryStore();
  const monitor = new GasVisionApp(telemetry);
  const analytics = new AnalyticsView(telemetry, monitor);
  const hazard = new HazardScanner(telemetry, monitor);
  const ventilation = new VentilationPlanner(document.getElementById('ventilationRoot'));
  const benchmark = new BenchmarkPanel(monitor);
  renderRoadmap(document.getElementById('roadmapGrid'));

  window.gasVisionTelemetry = telemetry;
  window.gasVisionApp = monitor;
  window.gasVisionBenchmark = benchmark;

  const router = new Router({
    monitor: {},
    analytics: { show: () => analytics.show(), hide: () => analytics.hide() },
    hazard: { show: (params) => hazard.show(params), hide: () => hazard.hide() },
    ventilation: { show: (params) => ventilation.show(params), hide: () => ventilation.hide() },
    roadmap: {}
  });
  window.gasVisionRouter = router;

  // Cross-screen shortcuts into the Hazard Scanner
  const assessCurrentFrame = () => router.go('hazard', { snapshot: monitor.getHazardSnapshot() });
  document.getElementById('assessNowBtn').addEventListener('click', assessCurrentFrame);
  document.getElementById('statusAssessBtn').addEventListener('click', assessCurrentFrame);

  // Nav badge: open incidents in the last 24 h
  const badge = document.getElementById('navIncidentBadge');
  const updateBadge = () => {
    const since = Date.now() - 24 * 3600 * 1000;
    const n = telemetry.incidentsSince(since).length;
    badge.hidden = n === 0;
    badge.textContent = n;
  };
  telemetry.onChange((kind) => { if (kind !== 'samples') updateBadge(); });
  updateBadge();

  router.resolve();
});
