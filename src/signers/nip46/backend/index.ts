import NDK, { NDKEvent, NDKPrivateKeySigner, NDKUser } from "../../../index.js";
import { NDKNostrRpc } from "../rpc.js";
import ConnectEventHandlingStrategy from "./connect.js";
import SignEventHandlingStrategy from "./sign-event.js";
import GetPublicKeyHandlingStrategy from "./get-public-key.js";
import DescribeEventHandlingStrategy from "./describe.js";

export type Nip46PermitCallback = (pubkey: string, method: string, params?: any) => Promise<boolean>;

export interface IEventHandlingStrategy {
    handle(
        backend: NDKNip46Backend,
        remotePubkey: string,
        params: string[]
    ): Promise<string|undefined>;
}

/**
 * This class implements a NIP-46 backend, meaning that it will hold a private key
 * of the npub that wants to be published as.
 *
 * This backend is meant to be used by an NDKNip46Signer, which is the class that
 * should run client-side, where the user wants to sign events from.
 */
export class NDKNip46Backend {
    readonly ndk: NDK;
    private signer: NDKPrivateKeySigner;
    public localUser?: NDKUser;
    readonly debug: debug.Debugger;
    private rpc: NDKNostrRpc;
    private permitCallback: Nip46PermitCallback;

    /**
     * @param ndk The NDK instance to use
     * @param privateKey The private key of the npub that wants to be published as
     */
    public constructor(ndk: NDK, privateKey: string, permitCallback: Nip46PermitCallback) {
        this.ndk = ndk;
        this.signer = new NDKPrivateKeySigner(privateKey);
        this.debug = ndk.debug.extend('nip46:backend');
        this.rpc = new NDKNostrRpc(ndk, this.signer, this.debug);
        this.permitCallback = permitCallback;
    }

    /**
     * This method starts the backend, which will start listening for incoming
     * requests.
     */
    public async start() {
        this.localUser = await this.signer.user();

        const sub = this.ndk.subscribe({
            kinds: [24133],
            '#p': [ this.localUser.hexpubkey() ]
        }, { closeOnEose: false });

        sub.on('event', (e) => this.handleIncomingEvent(e));
    }

    public handlers: { [method: string]: IEventHandlingStrategy } = {
        'connect': new ConnectEventHandlingStrategy(),
        'sign_event': new SignEventHandlingStrategy(),
        'get_public_key': new GetPublicKeyHandlingStrategy(),
        'describe': new DescribeEventHandlingStrategy(),
    };

    /**
     * Enables the user to set a custom strategy for handling incoming events.
     * @param method - The method to set the strategy for
     * @param strategy - The strategy to set
     */
    public setStrategy(method: string, strategy: IEventHandlingStrategy) {
        this.handlers[method] = strategy;
    }

    protected async handleIncomingEvent(event: NDKEvent) {
        const { id, method, params } = await this.rpc.parseEvent(event) as any;
        const remotePubkey = event.pubkey;
        let response: string | undefined;

        this.debug('incoming event', {id, method, params});

        const strategy = this.handlers[method];
        if (strategy) {
            response = await strategy.handle(this, remotePubkey, params);
        } else {
            this.debug('unsupported method', {method, params});
        }

        if (response) {
            this.debug(`sending response to ${remotePubkey}`, response);
            this.rpc.sendResponse(id, remotePubkey, response);
        }
    };

    public async signEvent(remotePubkey: string, params: string[]): Promise<NDKEvent|undefined> {
        const [ eventString ] = params;

        this.debug(`sign event request from ${remotePubkey}`);

        const event = new NDKEvent(this.ndk, JSON.parse(eventString));

        this.debug('event to sign', event.rawEvent());

        if (!await this.pubkeyAllowed(remotePubkey, 'sign_event', event)) {
            this.debug(`sign event request from ${remotePubkey} rejected`);
            return undefined;
        }

        this.debug(`sign event request from ${remotePubkey} allowed`);

        await event.sign(this.signer);
        return event;
    }

    /**
     * This method should be overriden by the user to allow or reject incoming
     * connections.
     */
    public async pubkeyAllowed(pubkey: string, method: string, params?: any): Promise<boolean> {
        return this.permitCallback(pubkey, method, params);
    }
}