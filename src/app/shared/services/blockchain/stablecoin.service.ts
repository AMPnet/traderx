import {Injectable} from '@angular/core'
import {BehaviorSubject, combineLatest, from, merge, Observable, of} from 'rxjs'
import {distinctUntilChanged, filter, map, switchMap, tap} from 'rxjs/operators'
import {ERC20__factory} from '../../../../../types/ethers-contracts'
import {SessionQuery} from '../../../session/state/session.query'
import {PreferenceQuery} from '../../../preference/state/preference.query'
import {BigNumber, BigNumberish} from 'ethers'
import {SignerService} from '../signer.service'
import {contractEvent} from '../../utils/ethersjs'
import {DialogService} from '../dialog.service'
import {formatUnits, parseUnits} from 'ethers/lib/utils'
import {GasService} from './gas.service'

@Injectable({
  providedIn: 'root',
})
export class StablecoinService {
  address = this.preferenceQuery.network.defaultStableCoin
  contract$ = combineLatest([
    this.sessionQuery.provider$,
  ]).pipe(
    distinctUntilChanged(),
    map(([provider]) => ERC20__factory.connect(this.address, provider)),
    switchMap(contract => of(contract).pipe(
      switchMap(contract => combineLatest([contract.decimals(), contract.symbol()])),
      tap(([decimals, symbol]) => {
        this.precisionSub.next(decimals)
        this.symbolSub.next(symbol)
      }),
      map(() => contract),
    )),
  )

  // TODO: set default to 18 digits when screens for managing
  //  will be finished.
  private precisionSub = new BehaviorSubject<number>(6)
  private symbolSub = new BehaviorSubject<string>('$')

  balance$: Observable<BigNumber> = combineLatest([
    this.contract$,
    this.sessionQuery.address$,
  ]).pipe(
    filter(([_contract, address]) => !!address),
    switchMap(([contract, address]) => merge(
      of(undefined),
      contractEvent(contract, contract.filters.Transfer(address!)),
      contractEvent(contract, contract.filters.Transfer(null, address!)),
    ).pipe(
      switchMap(() => contract.balanceOf(address!)),
    )),
  )

  constructor(private sessionQuery: SessionQuery,
              private preferenceQuery: PreferenceQuery,
              private signerService: SignerService,
              private dialogService: DialogService,
              private gasService: GasService) {
  }

  get precision() {
    return this.precisionSub.value
  }

  get symbol() {
    return this.symbolSub.value
  }

  format(wei: BigNumberish, precision?: number) {
    return Number(formatUnits(wei, precision ?? this.precision))
  }

  parse(amount: string | number, precision?: number) {
    const decimals = precision ?? this.precision
    const roundedAmount = Math.round(Number(amount) * 10 ** decimals) / 10 ** decimals
    return parseUnits(String(roundedAmount), precision ?? this.precision)
  }

  getAllowance(address: string): Observable<BigNumber> {
    return combineLatest([
      this.contract$,
      this.signerService.ensureAuth,
    ]).pipe(
      switchMap(([contract, _signer]) =>
        contract.allowance(this.sessionQuery.getValue().address!, address)),
    )
  }

  approveAmount(address: string, amount: BigNumber): Observable<unknown> {
    return combineLatest([
      this.contract$,
      this.signerService.ensureAuth,
    ]).pipe(
      map(([contract, signer]) => contract.connect(signer)),
      switchMap(contract => combineLatest([of(contract), this.gasService.overrides])),
      switchMap(([contract, overrides]) =>
        contract.populateTransaction.approve(address, amount, overrides),
      ),
      switchMap(tx => this.signerService.sendTransaction(tx)),
      switchMap(tx => this.dialogService.loading(
        from(this.sessionQuery.provider.waitForTransaction(tx.hash)),
        'Approving funds for trading',
      )),
    )
  }
}
