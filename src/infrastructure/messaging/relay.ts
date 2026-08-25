import { Channel, ChannelModel, connect } from 'amqplib';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../persistence/sequelize';

const EXCHANGE = 'crm.events';
const POLL_INTERVAL = 5000;
const CONNECT_MAX_ATTEMPTS = 30;
const CONNECT_RETRY_MS = 3000;

export class OutboxRelay {
  private model: ChannelModel | null = null;
  private channel: Channel | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  async start(rabbitmqUrl: string): Promise<void> {
    for (let attempt = 1; attempt <= CONNECT_MAX_ATTEMPTS; attempt++) {
      try {
        this.model = await connect(rabbitmqUrl);
        break;
      } catch (err) {
        if (attempt === CONNECT_MAX_ATTEMPTS) throw err;
        console.warn(
          `[plugin-outbox-relay] intento ${attempt}/${CONNECT_MAX_ATTEMPTS} falló, reintentando en ${CONNECT_RETRY_MS}ms...`,
        );
        await new Promise((r) => setTimeout(r, CONNECT_RETRY_MS));
      }
    }

    this.channel = await this.model!.createChannel();
    await this.channel.assertExchange(EXCHANGE, 'topic', { durable: true });

    this.timer = setInterval(() => this.drain(), POLL_INTERVAL);
    this.drain();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.channel?.close();
    await this.model?.close();
  }

  private async drain(): Promise<void> {
    if (!this.channel) return;
    try {
      const rows = await sequelize.query<{
        id: string; type: string; payload: unknown;
      }>(
        `SELECT id, type, payload FROM outbox_messages
          WHERE processed_at IS NULL
          ORDER BY occurred_at ASC LIMIT 50`,
        { type: QueryTypes.SELECT },
      );

      for (const row of rows) {
        this.channel.publish(
          EXCHANGE,
          row.type,
          Buffer.from(JSON.stringify(row.payload)),
          { persistent: true, headers: { eventId: row.id } },
        );
        await sequelize.query(
          'UPDATE outbox_messages SET processed_at = NOW() WHERE id = :id',
          { replacements: { id: row.id }, type: QueryTypes.UPDATE },
        );
      }
    } catch (err) {
      console.error('[plugin-outbox-relay] error al drenar outbox:', err);
    }
  }
}
