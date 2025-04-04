import { Listener, container } from "@sapphire/framework";

export class OnClientReady extends Listener {
  /**
   * constructor
   */
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, {
      ...options,
      event: 'ready'
    })
  }
  /**
   * run
   */
  public override async run() {
    const { client, logger } = container;
  }
}
