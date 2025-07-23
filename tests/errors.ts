// https://www.anchor-lang.com/docs/features/errors

export enum ErrorCode {
  // Constraint errors
  ConstraintSeeds = 2006,
  // Custom errors
  InvalidAuthority = 6001,
  InvalidProtocolFeeRecipient = 6002,
  InvalidTokenProgram = 6003,
  InvalidTokenOrder = 6004,
}
