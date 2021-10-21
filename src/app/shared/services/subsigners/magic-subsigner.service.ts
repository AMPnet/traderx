import {Injectable} from '@angular/core'
import {Subsigner, SubsignerLoginOpts} from './metamask-subsigner.service'
import {from, Observable, of, throwError} from 'rxjs'
import {providers} from 'ethers'
import {catchError, concatMap, map, switchMap, tap} from 'rxjs/operators'
import {AuthProvider, PreferenceStore} from '../../../preference/state/preference.store'
import {PreferenceQuery} from '../../../preference/state/preference.query'
import {SDKBase} from '@magic-sdk/provider/dist/types/core/sdk'
import {AuthMagicComponent, MagicLoginInput} from '../../../auth/auth-magic/auth-magic.component'
import {MatDialog} from '@angular/material/dialog'

@Injectable({
  providedIn: 'root',
})
export class MagicSubsignerService implements Subsigner {
  subprovider: SDKBase | undefined

  constructor(
    private preferenceStore: PreferenceStore,
    private preferenceQuery: PreferenceQuery,
    private matDialog: MatDialog,
  ) {
  }

  login(opts: SubsignerLoginOpts): Observable<providers.JsonRpcSigner> {
    return this.registerMagic.pipe( // TODO: check if logged in (passive login)
      map(p => new providers.Web3Provider(p as any).getSigner()),
      concatMap(signer => this.checkAuthenticated(signer, opts)),
      concatMap(signer => this.setAddress(signer)),
    )
  }

  logout(): Observable<unknown> {
    return of(this.subprovider?.user).pipe(
      switchMap(user => user ? user.logout() : of(null)),
    )
  }

  private setAddress(signer: providers.JsonRpcSigner) {
    return from(signer.getAddress()).pipe(
      tap(address => this.preferenceStore.update({
        address: address,
        authProvider: AuthProvider.MAGIC,
      })),
      map(() => signer),
    )
  }

  private get registerMagic() {
    return from(
      import(
        /* webpackChunkName: "magic-sdk" */
        'magic-sdk')).pipe(
      map((lib) => {
        return new lib.Magic('pk_test_A68B58AEF464EF47', { // TODO: extract key to env variable
          network: {
            chainId: this.preferenceQuery.network.chainID,
            rpcUrl: this.preferenceQuery.network.rpcURLs[0],
          }
        })
      }),
      tap(subprovider => this.subprovider = subprovider),
      map(subprovider => subprovider.rpcProvider),
    )
  }

  private checkAuthenticated(signer: providers.JsonRpcSigner,
                             opts: SubsignerLoginOpts): Observable<providers.JsonRpcSigner> {
    return of(opts.force).pipe(
      concatMap(force => force ?
        this.forceLogin :
        from(this.subprovider!.user.isLoggedIn())
      ),
      concatMap(authRes => authRes ? of(authRes) : throwError('NO_ADDRESS')),
      concatMap(() => of(signer)),
    )
  }

  private get forceLogin(): Observable<boolean> {
    return this.matDialog.open(AuthMagicComponent).afterClosed().pipe(
      switchMap((input: MagicLoginInput) => this.subprovider!.auth.loginWithMagicLink({email: input.email})),
      map(res => !!res),
      catchError(() => of(false))
    )
  }
}
