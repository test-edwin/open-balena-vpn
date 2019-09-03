/*
	Copyright (C) 2018 Balena Ltd.

	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published
	by the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.

	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU Affero General Public License for more details.

	You should have received a copy of the GNU Affero General Public License
	along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import * as Bluebird from 'bluebird';

import { apiKey, balenaApi, captureException } from '.';
import { ServiceRegistrationError } from './errors';

class ServiceInstance {
	private _id: number | null = null;

	constructor(private interval: number = 10 * 1000) {}

	private captureException(err: Error, fingerprint: string) {
		const tags: { [key: string]: string } = {};
		try {
			tags.instance_id = `${this.getId()}`;
			// tslint:disable-next-line:no-empty
		} catch {}

		captureException(err, fingerprint, { tags });
	}

	public register(): Bluebird<this> {
		return balenaApi
			.post({
				resource: 'service_instance',
				passthrough: { headers: { Authorization: `Bearer ${apiKey}` } },
			})
			.then(({ id }: { id?: number }) => {
				if (id == null) {
					throw new ServiceRegistrationError(
						'No service ID received on response',
					);
				}
				this.id = id;
				return this;
			})
			.catch(err => {
				this.captureException(err, 'service-registration-error');
				// Retry until it works
				return Bluebird.delay(this.interval).then(() => this.register());
			});
	}

	public scheduleHeartbeat(): Bluebird<boolean> {
		return (
			Bluebird.delay(this.interval)
				.bind(this)
				.then(this.sendHeartbeat)
				// Whether it worked or not, keep sending at the same interval
				.finally(this.scheduleHeartbeat)
		);
	}

	public sendHeartbeat(): Bluebird<boolean> {
		return balenaApi
			.patch({
				resource: 'service_instance',
				id: this.getId(),
				body: {
					// Just indicate being online, api handles the timestamp with hooks
					is_alive: true,
				},
				passthrough: { headers: { Authorization: `Bearer ${apiKey}` } },
			})
			.return(true)
			.catch(err => {
				this.captureException(err, 'service-heartbeart-error');
				return false;
			});
	}

	public wrap(func: (serviceInstance: this) => void): Bluebird<this> {
		return this.register()
			.tap(func)
			.bind(this)
			.tap(this.scheduleHeartbeat);
	}

	public getId(): number {
		if (this._id == null) {
			throw new ServiceRegistrationError('Not Registered');
		}
		return this._id;
	}

	set id(id: number) {
		if (this._id != null) {
			throw new ServiceRegistrationError('Already Registered');
		}
		this._id = id;
	}
}

export const service = new ServiceInstance();