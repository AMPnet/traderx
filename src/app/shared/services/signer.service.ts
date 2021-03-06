import {Injectable, NgZone} from '@angular/core'
import {providers, utils} from 'ethers'
import {defer, from, fromEvent, merge, Observable, of, Subject, throwError} from 'rxjs'
import {catchError, concatMap, finalize, map, switchMap, take, tap} from 'rxjs/operators'
import {SessionStore} from '../../session/state/session.store'
import {SessionQuery} from '../../session/state/session.query'
import {DialogService} from './dialog.service'
import {PreferenceStore} from '../../preference/state/preference.store'
import {MetamaskSubsignerService, Subsigner} from './subsigners/metamask-subsigner.service'
import {MatDialog} from '@angular/material/dialog'
import {AuthComponent} from '../../auth/auth.component'
import {RouterService} from './router.service'
import {ErrorService} from './error.service'
import {PreferenceQuery} from '../../preference/state/preference.query'
import {getWindow} from '../utils/browser'

@Injectable({
  providedIn: 'root',
})
export class SignerService {
  private subsigner: Subsigner = this.metamaskSubsignerService
  private accountsChangedSub = new Subject<string[]>()
  private chainChangedSub = new Subject<string>()
  private disconnectedSub = new Subject<void>()

  accountsChanged$ = this.accountsChangedSub.asObservable()
  chainChanged$ = this.chainChangedSub.asObservable()
  disconnected$ = this.disconnectedSub.asObservable()
  provider$ = this.sessionQuery.provider$

  private listenersSub = new Subject<any>()

  listeners$ = this.listenersSub.asObservable().pipe(
    switchMap(provider => merge(
      fromEvent<string[]>(provider, 'accountsChanged').pipe(
        map(accounts => () => this.accountsChangedSub.next(accounts)),
      ),
      fromEvent<string>(provider, 'chainChanged').pipe(
        map(chainID => () => this.chainChangedSub.next(chainID)),
      ),
      fromEvent<void>(provider, 'disconnect').pipe(
        map(() => () => this.disconnectedSub.next()),
      ),
    )),
    tap(action => this.ngZone.run(() => action())),
  )

  injectedWeb3$: Observable<any> = defer(() => of(getWindow()?.ethereum))

  constructor(private sessionStore: SessionStore,
              private sessionQuery: SessionQuery,
              private preferenceQuery: PreferenceQuery,
              private preferenceStore: PreferenceStore,
              private metamaskSubsignerService: MetamaskSubsignerService,
              private ngZone: NgZone,
              private router: RouterService,
              private dialog: MatDialog,
              private errorService: ErrorService,
              private dialogService: DialogService) {
    this.subscribeToChanges()
  }

  private setSigner(signer: providers.JsonRpcSigner): void {
    this.sessionStore.update({
      address: this.preferenceStore.getValue().address,
      authProvider: this.preferenceStore.getValue().authProvider,
      signer,
    })
    this.registerListeners()
  }

  get ensureAuth(): Observable<providers.JsonRpcSigner> {
    return of(this.sessionQuery.signer).pipe(
      concatMap(signer => signer ?
        from(signer.getAddress()).pipe(map(() => signer!)) :
        this.loginDialog.pipe(
          map(() => this.sessionQuery.signer!),
        ),
      ),
    )
  }

  get ensureNetwork(): Observable<void> {
    if (!this.sessionQuery.signer) return of(undefined)

    return from(this.sessionQuery.signer.getChainId()).pipe(
      switchMap(chainId => {
        if (chainId !== this.preferenceQuery.network.chainID) {
          return this.logout()
        }

        return of(undefined)
      }),
      map(() => undefined)
    )
  }

  private get loginDialog() {
    return this.dialog.open(AuthComponent).afterClosed().pipe(
      concatMap(authCompleted => authCompleted ?
        this.sessionQuery.waitUntilLoggedIn() :
        throwError('LOGIN_MODAL_DISMISSED')),
    )
  }

  login<T extends Subsigner>(subsigner: T, opts: LoginOpts = {force: true}): Observable<providers.JsonRpcSigner> {
    this.subsigner = subsigner
    return this.subsigner.login(opts).pipe(
      tap(signer => this.setSigner(signer)),
    )
  }

  logout(): Observable<unknown> {
    return this.subsigner.logout().pipe(
      finalize(() => {
        this.preferenceStore.update({address: '', authProvider: ''})
        this.sessionStore.update({address: '', signer: undefined})
      }),
    )
  }

  getAddress(): Observable<string> {
    return this.ensureAuth.pipe(
      switchMap(signer => from(signer.getAddress())),
    )
  }

  signMessage(message: string | utils.Bytes): Observable<string> {
    return this.ensureAuth.pipe(
      switchMap(signer => from(signer.signMessage(message))),
      this.errorService.handleError(),
    )
  }

  sendTransaction(transaction: providers.TransactionRequest):
    Observable<providers.TransactionResponse> {
    return this.ensureAuth.pipe(
      switchMap(signer => from(signer.sendTransaction(transaction))),
      this.errorService.handleError(false, true),
    )
  }

  registerListeners(): void {
    const provider = this.sessionQuery.signer?.provider as any
    const providerWithEvents = provider?.provider['_events'] ? provider.provider : provider

    this.listenersSub.next(providerWithEvents)
  }

  private subscribeToChanges(): void {
    this.accountsChanged$.pipe(
      concatMap((accounts) => accounts.length === 0 ? this.logoutNavToExplore() : of(accounts)),
      concatMap(() => this.sessionQuery.signer?.getAddress() || of('')),
      tap(account => {
        if (account) {
          this.sessionStore.update({address: account})
          this.preferenceStore.update({address: account})
        }
      }),
    ).subscribe()

    this.chainChanged$.pipe(
      concatMap(chainID => this.provider$.pipe(take(1),
        concatMap(provider => provider.getNetwork()),
        concatMap(network => utils.hexValue(network.chainId) === chainID ?
          of(network) : this.logoutNavToExplore())),
      ),
      // provider.getNetwork() sometimes throws error on network mismatch.
      catchError(() => this.logoutNavToExplore()),
    ).subscribe()

    this.disconnected$.pipe(
      tap(() =>
        this.logoutNavToExplore().subscribe(),
      ),
    ).subscribe()

    this.listeners$.subscribe()
  }

  private logoutNavToExplore(): Observable<unknown> {
    return of(this.sessionQuery.isLoggedIn()).pipe(
      concatMap(isLoggedIn => isLoggedIn ? this.logout() : of(isLoggedIn)),
      concatMap(() => this.ngZone.run(() => this.router.navigate(['/explore']))),
    )
  }
}

interface LoginOpts {
  email?: string;
  wallet?: string;
  force?: boolean;
}
