import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { CronJob } from 'cron';
import { AutomationsService } from './automations.service';
import { AuditService } from '../../audit/audit.service';

export interface JobDefinition {
  key: string;
  name: string;
  cron: string;
  description: string;
}

export interface JobState extends JobDefinition {
  enabled: boolean;
  lastRunAt: string | null;
  lastResult: { candidates: number; sent: number } | null;
  lastError: string | null;
  nextRunAt: string | null;
}

/**
 * Runs the administrative automations unattended.
 *
 * Schedules are cron expressions in the academy's timezone (Asia/Dubai). Every
 * job is disabled by default so nothing emails parents until someone turns it
 * on deliberately — flip AUTOMATIONS_ENABLED=true (or enable a single job via
 * the API) once the messaging provider credentials are in place.
 */
@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger('Scheduler');
  private readonly tz = 'Asia/Dubai';
  private readonly state = new Map<string, JobState>();

  private readonly definitions: JobDefinition[] = [
    { key: 'payment-reminders', name: 'Overdue payment reminders', cron: '0 9 * * *',
      description: 'Every day at 09:00 — emails guardians whose invoices are past due' },
    { key: 'trial-confirmations', name: 'Trial confirmations', cron: '0 18 * * *',
      description: 'Every day at 18:00 — confirms trials booked in the next 3 days' },
    { key: 'renewal-reminders', name: 'Renewal reminders', cron: '0 10 * * 1',
      description: 'Mondays at 10:00 — nudges families whose term ends within 30 days' },
    { key: 'registration-confirmations', name: 'Registration welcome', cron: '0 * * * *',
      description: 'Hourly — welcomes players registered in the last hour' },
  ];

  constructor(
    private readonly automations: AutomationsService,
    private readonly registry: SchedulerRegistry,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    const globallyEnabled = this.config.get<string>('AUTOMATIONS_ENABLED') === 'true';
    for (const def of this.definitions) {
      this.state.set(def.key, {
        ...def, enabled: globallyEnabled,
        lastRunAt: null, lastResult: null, lastError: null, nextRunAt: null,
      });
      const job = new CronJob(def.cron, () => this.run(def.key), null, false, this.tz);
      this.registry.addCronJob(def.key, job as any);
      if (globallyEnabled) job.start();
      this.refreshNext(def.key);
    }
    this.logger.log(
      globallyEnabled
        ? `Automations ENABLED — ${this.definitions.length} scheduled jobs running`
        : `Automations registered but DISABLED (set AUTOMATIONS_ENABLED=true, or enable individually)`,
    );
  }

  private refreshNext(key: string) {
    const s = this.state.get(key);
    if (!s) return;
    try {
      const job = this.registry.getCronJob(key) as any;
      s.nextRunAt = s.enabled && job.running ? new Date(job.nextDate().toMillis?.() ?? job.nextDate()).toISOString() : null;
    } catch { s.nextRunAt = null; }
  }

  /** Execute one automation for real and record the outcome. */
  async run(key: string) {
    const s = this.state.get(key);
    if (!s) return;
    this.logger.log(`Running "${s.name}"…`);
    try {
      const fn: Record<string, () => Promise<any>> = {
        'payment-reminders': () => this.automations.paymentReminders({ dryRun: false }),
        'trial-confirmations': () => this.automations.trialConfirmations({ dryRun: false }),
        'renewal-reminders': () => this.automations.renewalReminders({ dryRun: false }),
        'registration-confirmations': () => this.automations.registrationConfirmations({ dryRun: false, sinceHours: 1 }),
      };
      const res = await fn[key]();
      s.lastRunAt = new Date().toISOString();
      s.lastResult = { candidates: res.candidates, sent: res.sent };
      s.lastError = null;
      this.logger.log(`"${s.name}" — ${res.sent} sent of ${res.candidates} candidate(s)`);
      await this.audit.record({
        action: 'scheduler.run', actorType: 'system', entity: 'automation', entityId: key,
        metadata: { candidates: res.candidates, sent: res.sent },
      });
    } catch (e: any) {
      s.lastError = e.message;
      s.lastRunAt = new Date().toISOString();
      this.logger.error(`"${s.name}" failed: ${e.message}`);
      await this.audit.record({
        action: 'scheduler.error', actorType: 'system', entity: 'automation', entityId: key,
        metadata: { error: e.message },
      });
    }
    this.refreshNext(key);
  }

  list(): JobState[] {
    this.definitions.forEach((d) => this.refreshNext(d.key));
    return [...this.state.values()];
  }

  setEnabled(key: string, enabled: boolean): JobState {
    const s = this.state.get(key);
    if (!s) throw new Error(`Unknown job "${key}"`);
    const job = this.registry.getCronJob(key) as any;
    enabled ? job.start() : job.stop();
    s.enabled = enabled;
    this.refreshNext(key);
    this.logger.log(`"${s.name}" ${enabled ? 'enabled' : 'disabled'}`);
    return s;
  }

  /** Change a job's schedule at runtime (cron expression, Asia/Dubai). */
  setSchedule(key: string, cron: string): JobState {
    const s = this.state.get(key);
    if (!s) throw new Error(`Unknown job "${key}"`);
    const existing = this.registry.getCronJob(key) as any;
    existing.stop();
    this.registry.deleteCronJob(key);
    const job = new CronJob(cron, () => this.run(key), null, false, this.tz);
    this.registry.addCronJob(key, job as any);
    if (s.enabled) job.start();
    s.cron = cron;
    this.refreshNext(key);
    return s;
  }
}
