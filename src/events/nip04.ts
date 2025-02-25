import NDKEvent from '.';
import { NDKSigner } from '../signers';
import NDKUser from '../user';

export async function encrypt(this: NDKEvent, recipient: NDKUser, signer?: NDKSigner) {
    if (!signer) {
        if (!this.ndk) {
            throw new Error('No signer available');
        }

        await this.ndk.assertSigner();

        signer = this.ndk.signer!;
    }

    this.content = await signer.encrypt(recipient, this.content);
}

export async function decrypt(this: NDKEvent, sender: NDKUser, signer?: NDKSigner) {
    if (!signer) {
        if (!this.ndk) {
            throw new Error('No signer available');
        }

        await this.ndk.assertSigner();

        signer = this.ndk.signer!;
    }

    this.content = await signer.decrypt(sender, this.content);
}
